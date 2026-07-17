import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  Locale,
  NotificationChannel,
  NotificationProvider,
  NotificationStatus,
  NotificationTemplateType,
  Prisma,
  RegistrationStatus,
} from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { QrImageService } from '../qr/qr-image.service';
import { QrService } from '../qr/qr.service';
import { BulkRetryFailedNotificationsDto } from './dto/bulk-retry-failed-notifications.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { FailedSummaryQueryDto } from './dto/failed-summary-query.dto';
import { ListNotificationLogsQueryDto } from './dto/list-notification-logs-query.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { SendRegistrationQrDto } from './dto/send-registration-qr.dto';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';
import { WhatsAppProviderError } from './providers/whatsapp-provider.error';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS)
    private readonly whatsappNotificationsQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
  ) {}

  async createTemplate(dto: CreateNotificationTemplateDto) {
    await this.ensureTemplateIsUnique(
      dto.eventId ?? null,
      dto.type,
      dto.channel,
      dto.locale ?? Locale.AR,
    );

    return this.prisma.notificationTemplate.create({
      data: dto,
    });
  }

  async findTemplates(query: ListTemplatesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.NotificationTemplateWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notificationTemplate.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findTemplate(id: string) {
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Notification template not found');
    }

    return template;
  }

  async updateTemplate(id: string, dto: UpdateNotificationTemplateDto) {
    await this.findTemplate(id);

    return this.prisma.notificationTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async removeTemplate(id: string) {
    await this.findTemplate(id);

    const template = await this.prisma.notificationTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return { deactivated: true, template };
  }

  async sendRegistrationQr(dto: SendRegistrationQrDto) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: dto.registrationId },
      include: {
        event: true,
        attendeeType: true,
        qrToken: true,
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    if (registration.status !== RegistrationStatus.ACTIVE) {
      throw new BadRequestException('Registration must be ACTIVE');
    }

    if (!registration.phone) {
      throw new BadRequestException('Registration phone is required');
    }

    const dedupeKey = this.buildRegistrationQrDedupeKey({
      eventId: registration.eventId,
      registrationId: registration.id,
      forceResend: dto.forceResend === true,
    });
    const existingLog = dto.forceResend
      ? null
      : await this.prisma.notificationLog.findUnique({
          where: { dedupeKey },
        });

    if (existingLog) {
      if (
        existingLog.status === NotificationStatus.PENDING ||
        existingLog.status === NotificationStatus.SENT ||
        existingLog.status === NotificationStatus.DELIVERED
      ) {
        return {
          skipped: true,
          reason: `NOTIFICATION_${existingLog.status}`,
          log: existingLog,
        };
      }

      if (existingLog.status === NotificationStatus.FAILED) {
        return {
          skipped: true,
          reason: 'NOTIFICATION_FAILED_RETRY_REQUIRED',
          log: existingLog,
        };
      }
    }

    const qr = registration.qrToken
      ? await this.qrService.findByRegistration(registration.id)
      : await this.qrService.generate(registration.id);
    const template = await this.resolveTemplate(
      registration.eventId,
      dto.locale ?? Locale.AR,
    );
    const content = this.renderTemplate(template?.content, {
      fullName: registration.fullName,
      eventTitle: registration.event.titleAr,
      qrLink: `${this.configService.get<string>('APP_PUBLIC_BASE_URL', 'http://localhost:3000')}/qr/${registration.publicId}`,
      qrToken: qr.qrToken,
      registrationPublicId: registration.publicId,
    }, dto.locale ?? Locale.AR);
    const providerName = this.configService.get<NotificationProvider>(
      'WHATSAPP_PROVIDER',
      NotificationProvider.FAKE,
    );
    const log = await this.createNotificationLogOrReadExisting({
      eventId: registration.eventId,
      registrationId: registration.id,
      templateId: template?.id,
      provider: providerName,
      recipient: registration.phone,
      content,
      dedupeKey,
      locale: dto.locale ?? Locale.AR,
      forceResend: dto.forceResend ?? false,
    });

    if (!dto.forceResend && log.status !== NotificationStatus.PENDING) {
      return {
        skipped: true,
        reason: `NOTIFICATION_${log.status}`,
        log,
      };
    }

    const enqueueResult = await this.enqueueWhatsAppLog(log.id);

    return { queued: enqueueResult.queued, log, jobId: enqueueResult.jobId };
  }

  async sendRegistrationTicketImage(input: {
    registrationId: string;
    imageUrl: string;
    recipient?: string;
    dedupeKey?: string;
    locale?: Locale;
    forceResend?: boolean;
  }) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: input.registrationId },
      include: {
        event: true,
        attendeeType: true,
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    if (registration.status !== RegistrationStatus.ACTIVE) {
      throw new BadRequestException('Registration must be ACTIVE');
    }

    if (!registration.phone) {
      throw new BadRequestException('Registration phone is required');
    }

    this.assertPublicImageUrlCanBeSent(input.imageUrl);
    const locale = input.locale ?? Locale.AR;
    const recipient = input.recipient ?? registration.phone;
    const dedupeKey =
      input.dedupeKey ??
      this.buildRegistrationQrDedupeKey({
        eventId: registration.eventId,
        registrationId: registration.id,
        forceResend: input.forceResend === true,
      });
    const existingLog = input.forceResend
      ? null
      : await this.prisma.notificationLog.findUnique({
          where: { dedupeKey },
        });

    if (existingLog) {
      if (
        existingLog.status === NotificationStatus.PENDING ||
        existingLog.status === NotificationStatus.SENT ||
        existingLog.status === NotificationStatus.DELIVERED
      ) {
        return {
          skipped: true,
          reason: `NOTIFICATION_${existingLog.status}`,
          log: existingLog,
        };
      }

      if (existingLog.status === NotificationStatus.FAILED) {
        return {
          skipped: true,
          reason: 'NOTIFICATION_FAILED_RETRY_REQUIRED',
          log: existingLog,
        };
      }
    }

    const template = await this.resolveTemplate(registration.eventId, locale);
    const content = this.renderTicketCaption(
      template?.content,
      {
        fullName: registration.fullName,
        eventTitle: registration.event.titleAr,
      },
      locale,
    );
    const providerName = this.configService.get<NotificationProvider>(
      'WHATSAPP_PROVIDER',
      NotificationProvider.FAKE,
    );
    const log = await this.createNotificationLogOrReadExisting({
      eventId: registration.eventId,
      registrationId: registration.id,
      templateId: template?.id,
      provider: providerName,
      recipient,
      content,
      dedupeKey,
      locale,
      forceResend: input.forceResend ?? false,
      metadata: {
        imageUrl: input.imageUrl,
        mediaType: 'DIGITAL_TICKET',
      },
    });

    if (!input.forceResend && log.status !== NotificationStatus.PENDING) {
      return {
        skipped: true,
        reason: `NOTIFICATION_${log.status}`,
        log,
      };
    }

    const enqueueResult = await this.enqueueWhatsAppLog(log.id);

    return { queued: enqueueResult.queued, log, jobId: enqueueResult.jobId };
  }

  async deliverQueuedWhatsApp(input: {
    notificationLogId: string;
    attemptNumber: number;
    isFinalAttempt: boolean;
  }) {
    try {
      const log = await this.prisma.notificationLog.findUnique({
        where: { id: input.notificationLogId },
        include: {
          registration: {
            include: {
              event: true,
              qrToken: true,
            },
          },
        },
      });

      if (!log) {
        return { skipped: true, reason: 'NOTIFICATION_LOG_NOT_FOUND' };
      }

      if (
        log.status === NotificationStatus.SENT ||
        log.status === NotificationStatus.DELIVERED
      ) {
        return { skipped: true, reason: 'NOTIFICATION_ALREADY_SENT', log };
      }

      const metadata = this.toMetadata(log.metadata);
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: NotificationStatus.PENDING,
          errorCode: null,
          errorMessage: null,
          failedAt: null,
          metadata: {
            ...metadata,
            attempts: input.attemptNumber,
            lastAttemptAt: new Date().toISOString(),
          },
        },
      });

      if (!log.registration) {
        throw new WhatsAppProviderError(
          'Notification log registration is required',
          'NOTIFICATION_REGISTRATION_REQUIRED',
          { permanent: true, retryable: false },
        );
      }

      let imageUrl =
        typeof metadata.imageUrl === 'string' ? metadata.imageUrl : undefined;

      if (!imageUrl) {
        const qr = log.registration.qrToken
          ? await this.qrService.findByRegistration(log.registration.id)
          : await this.qrService.generate(log.registration.id);
        const qrImage = await this.qrImageService.generateRegistrationQrImage({
          registrationPublicId: log.registration.publicId,
          qrToken: qr.qrToken,
        });
        imageUrl = qrImage.publicUrl;
      }

      this.assertPublicImageUrlCanBeSent(imageUrl);
      const provider = new WhatsAppProviderFactory(this.configService).create();
      const providerResult = await provider.sendWhatsAppMessage({
        to: log.recipient,
        message: log.content,
        imageUrl,
        metadata: { registrationId: log.registration.id, notificationLogId: log.id },
      });
      const updatedLog = await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          failedAt: null,
          provider: providerResult.provider,
          providerMessageId: providerResult.providerMessageId,
          metadata: {
            ...metadata,
            attempts: input.attemptNumber,
            imageUrl,
            raw: providerResult.raw ?? null,
          },
        },
      });

      return { log: updatedLog, providerResult };
    } catch (error) {
      const normalizedError = this.normalizeSendError(error);
      const retryable = normalizedError.retryable && !normalizedError.permanent;
      const finalFailure = input.isFinalAttempt || !retryable;
      const updatedLog = await this.prisma.notificationLog.update({
        where: { id: input.notificationLogId },
        data: {
          status: finalFailure
            ? NotificationStatus.FAILED
            : NotificationStatus.PENDING,
          failedAt: finalFailure ? new Date() : null,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
          metadata: {
            ...(await this.getCurrentMetadata(input.notificationLogId)),
            attempts: input.attemptNumber,
            lastErrorAt: new Date().toISOString(),
            retryAfterMs: normalizedError.retryAfterMs ?? null,
            statusCode: normalizedError.statusCode ?? null,
            safeDetails: normalizedError.safeDetails ?? null,
          },
        },
      });

      if (normalizedError.permanent) {
        throw new UnrecoverableError(normalizedError.message);
      }

      if (!input.isFinalAttempt) {
        throw error;
      }

      return { log: updatedLog };
    }
  }

  async findLogs(query: ListNotificationLogsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.NotificationLogWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.registrationId ? { registrationId: query.registrationId } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.recipient ? { recipient: { contains: query.recipient } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findLog(id: string) {
    const log = await this.prisma.notificationLog.findUnique({
      where: { id },
    });

    if (!log) {
      throw new NotFoundException('Notification log not found');
    }

    return log;
  }

  async failedSummary(query: FailedSummaryQueryDto) {
    const sinceMinutes =
      query.sinceMinutes ??
      this.configService.get<number>(
        'WHATSAPP_SEND_FAILED_ALERT_WINDOW_MINUTES',
        15,
      );
    const threshold = this.configService.get<number>(
      'WHATSAPP_SEND_FAILED_ALERT_THRESHOLD',
      10,
    );
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const items = await this.prisma.notificationLog.findMany({
      where: {
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.FAILED,
        failedAt: { gte: since },
      },
      orderBy: { failedAt: 'desc' },
      take: 100,
    });

    return {
      failedCount: items.length,
      threshold,
      alert: items.length >= threshold,
      items: items.map((item) => ({
        id: item.id,
        registrationId: item.registrationId,
        recipient: item.recipient,
        provider: item.provider,
        status: item.status,
        attempts: this.getAttempts(item.metadata),
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        failedAt: item.failedAt,
      })),
    };
  }

  async retryLog(id: string) {
    const log = await this.findLog(id);

    if (log.status !== NotificationStatus.FAILED) {
      throw new BadRequestException('Only FAILED notification logs can be retried');
    }

    await this.markLogPendingForRetry(log.id);
    const job = await this.enqueueWhatsAppLog(log.id, true);

    return { queued: job.queued, logId: log.id, jobId: job.jobId };
  }

  async retryFailed(dto: BulkRetryFailedNotificationsDto) {
    const sinceMinutes = dto.sinceMinutes ?? 60;
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.FAILED,
        failedAt: { gte: since },
      },
      orderBy: { failedAt: 'desc' },
      take: dto.limit ?? 100,
    });
    const jobs = await Promise.all(
      logs.map(async (log) => {
        await this.markLogPendingForRetry(log.id);

        return this.enqueueWhatsAppLog(log.id, true);
      }),
    );

    return {
      queued: jobs.length,
      logIds: logs.map((log) => log.id),
    };
  }

  private async resolveTemplate(eventId: string, locale: Locale) {
    return this.prisma.notificationTemplate.findFirst({
      where: {
        type: NotificationTemplateType.REGISTRATION_QR,
        channel: NotificationChannel.WHATSAPP,
        locale,
        isActive: true,
        OR: [{ eventId }, { eventId: null }],
      },
      orderBy: [{ eventId: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async enqueueWhatsAppLog(logId: string, manualRetry = false) {
    const jobId = this.getWhatsAppJobId(logId);
    const existingJob = await this.whatsappNotificationsQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (manualRetry && state === 'failed') {
        try {
          await existingJob.retry('failed');

          return { queued: true, alreadyQueued: false, jobId };
        } catch (error) {
          await this.markLogFailedAfterEnqueueError(logId, error);

          return { queued: false, alreadyQueued: false, jobId };
        }
      }

      return { queued: true, alreadyQueued: true, jobId };
    }

    try {
      const job = await this.whatsappNotificationsQueue.add(
        'whatsapp.send',
        { notificationLogId: logId, manualRetry },
        {
          jobId,
          attempts: this.configService.get<number>(
            'WHATSAPP_SEND_MAX_ATTEMPTS',
            5,
          ),
          backoff: {
            type: 'exponential',
            delay: this.configService.get<number>(
              'WHATSAPP_SEND_RETRY_BACKOFF_MS',
              5000,
            ),
          },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        },
      );

      return { queued: true, alreadyQueued: false, jobId: String(job.id) };
    } catch (error) {
      await this.markLogFailedAfterEnqueueError(logId, error);

      return { queued: false, alreadyQueued: false, jobId };
    }
  }

  private toMetadata(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private getAttempts(value: Prisma.JsonValue) {
    const attempts = this.toMetadata(value).attempts;

    return typeof attempts === 'number' ? attempts : 0;
  }

  private buildRegistrationQrDedupeKey(input: {
    eventId: string;
    registrationId: string;
    forceResend: boolean;
  }) {
    const base = `${NotificationTemplateType.REGISTRATION_QR}:${input.eventId}:${input.registrationId}`;

    return input.forceResend ? `${base}:resend:${Date.now()}` : base;
  }

  private async createNotificationLogOrReadExisting(input: {
    eventId: string;
    registrationId: string;
    templateId?: string;
    provider: NotificationProvider;
    recipient: string;
    content: string;
    dedupeKey: string;
    locale: Locale;
    forceResend: boolean;
    metadata?: Record<string, unknown>;
  }) {
    try {
      return await this.prisma.notificationLog.create({
        data: {
          eventId: input.eventId,
          registrationId: input.registrationId,
          templateId: input.templateId,
          notificationType: NotificationTemplateType.REGISTRATION_QR,
          dedupeKey: input.dedupeKey,
          channel: NotificationChannel.WHATSAPP,
          provider: input.provider,
          recipient: input.recipient,
          status: NotificationStatus.PENDING,
          content: input.content,
          metadata: {
            attempts: 0,
            locale: input.locale,
            forceResend: input.forceResend,
            ...(input.metadata ?? {}),
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.notificationLog.findUnique({
          where: { dedupeKey: input.dedupeKey },
        });

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  private getWhatsAppJobId(logId: string) {
    return `whatsapp-${logId}`;
  }

  private async markLogPendingForRetry(logId: string) {
    const metadata = await this.getCurrentMetadata(logId);

    return this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: NotificationStatus.PENDING,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        metadata: {
          ...metadata,
          retryQueuedAt: new Date().toISOString(),
        },
      },
    });
  }

  private async markLogFailedAfterEnqueueError(logId: string, error: unknown) {
    const metadata = await this.getCurrentMetadata(logId);

    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: NotificationStatus.FAILED,
        failedAt: new Date(),
        errorCode: 'WHATSAPP_ENQUEUE_FAILED',
        errorMessage: this.safeErrorMessage(error),
        metadata: {
          ...metadata,
          enqueueFailedAt: new Date().toISOString(),
        },
      },
    });
  }

  private async getCurrentMetadata(logId: string) {
    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
      select: { metadata: true },
    });

    return this.toMetadata(log?.metadata ?? null);
  }

  private normalizeSendError(error: unknown) {
    if (error instanceof WhatsAppProviderError) {
      return {
        code: error.code,
        message: this.safeErrorMessage(error),
        retryable: error.retryable || !error.permanent,
        permanent: error.permanent,
        retryAfterMs: error.retryAfterMs,
        statusCode: error.statusCode,
        safeDetails: error.safeDetails,
      };
    }

    return {
      code: 'WHATSAPP_SEND_FAILED',
      message: this.safeErrorMessage(error),
      retryable: true,
      permanent: false,
      retryAfterMs: undefined,
      statusCode: undefined,
      safeDetails: undefined,
    };
  }

  private safeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : 'WhatsApp failed';

    return message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
  }

  private assertPublicImageUrlCanBeSent(imageUrl: string) {
    const provider = this.configService.get<NotificationProvider>(
      'WHATSAPP_PROVIDER',
      NotificationProvider.FAKE,
    );

    if (provider === NotificationProvider.FAKE) {
      return;
    }

    const parsed = new URL(imageUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
    ) {
      throw new WhatsAppProviderError(
        'Public QR image URL is not accessible for WhatsApp delivery',
        'WHATSAPP_PUBLIC_URL_INVALID',
        { permanent: true, retryable: false },
      );
    }
  }

  private renderTemplate(
    content: string | undefined,
    variables: Record<string, string>,
    locale: Locale,
  ) {
    const fallback =
      locale === Locale.EN
        ? 'Hello {{fullName}}, you are registered for {{eventTitle}}. Your entry QR: {{qrLink}}'
        : 'مرحبا {{fullName}}، تم تسجيلك في {{eventTitle}}. رمز الدخول الخاص بك: {{qrLink}}';
    let rendered = content ?? fallback;

    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }

    return rendered;
  }

  private renderTicketCaption(
    content: string | undefined,
    variables: Record<string, string>,
    locale: Locale,
  ) {
    const fallback =
      locale === Locale.EN
        ? 'Hello {{fullName}}, your ticket for {{eventTitle}} is attached.'
        : 'ظ…ط±ط­ط¨ط§ {{fullName}}طŒ طھط°ظƒط±طھظƒ ظ„ظپط¹ط§ظ„ظٹط© {{eventTitle}} ظ…ط±ظپظ‚ط©.';
    let rendered = content ?? fallback;

    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }

    return rendered;
  }

  private async ensureTemplateIsUnique(
    eventId: string | null,
    type: NotificationTemplateType,
    channel: NotificationChannel,
    locale: Locale,
  ) {
    const existingTemplate = await this.prisma.notificationTemplate.findFirst({
      where: { eventId, type, channel, locale },
    });

    if (existingTemplate) {
      throw new ConflictException('Notification template already exists');
    }
  }
}
