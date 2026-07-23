import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Locale, Prisma, RegistrationStatus } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { DigitalTicketsService } from '../digital-tickets/digital-tickets.service';
import { NotificationsService } from '../notifications/notifications.service';

type WasenderWebhookResult = {
  ignored?: boolean;
  reason?: string;
  queued?: boolean;
  jobId?: string;
  notificationLogId?: string;
};

type IncomingMessage = {
  deliveryId: string;
  eventType: string;
  text: string;
  senderPhone: string;
  outgoing: boolean;
  group: boolean;
};

type ClaimTicketRequestSenderInput = {
  registrationId: string;
  senderPhone: string;
  ticketRequestToken: string;
};

@Injectable()
export class WhatsappTicketRequestsService {
  /**
   * مثال:
   * REG_237DA5E4E4DC3E43
   */
  private readonly publicIdPattern =
    /(?:^|[^A-Z0-9_-])(REG_[A-Z0-9_-]{1,60})(?![A-Z0-9_-])/i;

  /**
   * مثال:
   * WTR_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   */
  private readonly ticketRequestTokenPattern =
    /(?:^|[^A-Za-z0-9_-])(WTR_[A-Za-z0-9_-]{20,100})(?![A-Za-z0-9_-])/;

  constructor(
    private readonly configService: ConfigService,
    private readonly digitalTicketsService: DigitalTicketsService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ينشئ رابط WhatsApp جديدًا للتسجيل.
   *
   * كل مرة يتم إنشاء رابط جديد:
   * - يتم إنشاء رمز طلب جديد.
   * - تنتهي صلاحية الرمز القديم.
   * - يتم إلغاء ربط أي حساب WhatsApp سابق.
   * - يصبح أول حساب يرسل الرمز الجديد هو الحساب المعتمد.
   */
  async createForRegistration(registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: {
        id: registrationId,
      },
      select: {
        id: true,
        publicId: true,
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    const expiresHours = this.configService.get<number>(
      'WHATSAPP_TICKET_REQUEST_EXPIRES_HOURS',
      24,
    );

    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

    const ticketRequestToken = await this.persistUniqueToken(
      registration.id,
      expiresAt,
    );

    return {
      enabled: true,
      ticketRequestToken,
      url: this.buildWhatsAppUrl(registration.publicId, ticketRequestToken),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * يستقبل Webhook الرسائل الواردة من Wasender.
   *
   * آلية الأمان:
   * 1. التحقق من Webhook Secret.
   * 2. استخراج رقم التسجيل.
   * 3. استخراج رمز الطلب السري.
   * 4. التحقق من صلاحية الرمز.
   * 5. ربط أول حساب WhatsApp يرسل الطلب بالتسجيل.
   * 6. السماح لنفس الحساب بإعادة الطلب.
   * 7. رفض أي حساب آخر يحاول استخدام الرسالة نفسها.
   */
  async handleWasenderWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: Record<string, unknown>,
  ): Promise<WasenderWebhookResult> {
    this.validateWebhookSecret(headers);

    const message = this.extractIncomingMessage(payload);

    const delivery = await this.recordDelivery(message.deliveryId, payload);

    if (delivery.duplicate) {
      return {
        ignored: true,
        reason: 'DUPLICATE_WEBHOOK_DELIVERY',
      };
    }

    if (message.eventType !== 'messages.received') {
      await this.markDelivery(delivery.id, 'IGNORED', 'UNSUPPORTED_EVENT');

      return {
        ignored: true,
        reason: 'UNSUPPORTED_EVENT',
      };
    }

    if (message.outgoing) {
      await this.markDelivery(delivery.id, 'IGNORED', 'OUTGOING_MESSAGE');

      return {
        ignored: true,
        reason: 'OUTGOING_MESSAGE',
      };
    }

    if (message.group) {
      await this.markDelivery(delivery.id, 'IGNORED', 'GROUP_MESSAGE');

      return {
        ignored: true,
        reason: 'GROUP_MESSAGE',
      };
    }

    const publicId = this.extractPublicId(message.text);

    if (!publicId) {
      await this.markDelivery(delivery.id, 'REJECTED', 'PUBLIC_ID_NOT_FOUND');

      return {
        ignored: true,
        reason: 'PUBLIC_ID_NOT_FOUND',
      };
    }

    const ticketRequestToken = this.extractTicketRequestToken(message.text);

    if (!ticketRequestToken) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'TICKET_REQUEST_TOKEN_NOT_FOUND',
      );

      return {
        ignored: true,
        reason: 'TICKET_REQUEST_TOKEN_NOT_FOUND',
      };
    }

    const registration = await this.prisma.registration.findUnique({
      where: {
        publicId,
      },
    });

    if (!registration) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'REGISTRATION_NOT_FOUND',
      );

      return {
        ignored: true,
        reason: 'REGISTRATION_NOT_FOUND',
      };
    }

    if (registration.status !== RegistrationStatus.ACTIVE) {
      await this.markDelivery(delivery.id, 'REJECTED', 'REGISTRATION_INACTIVE');

      return {
        ignored: true,
        reason: 'REGISTRATION_INACTIVE',
      };
    }

    /**
     * نتحقق من أن الرمز الموجود داخل الرسالة
     * هو الرمز الحالي الخاص بالتسجيل.
     */
    if (
      !registration.ticketRequestToken ||
      !this.safeSecretEquals(
        ticketRequestToken,
        registration.ticketRequestToken,
      )
    ) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'INVALID_TICKET_REQUEST_TOKEN',
      );

      return {
        ignored: true,
        reason: 'INVALID_TICKET_REQUEST_TOKEN',
      };
    }

    /**
     * التحقق من صلاحية رابط الطلب.
     */
    if (
      !registration.ticketRequestExpiresAt ||
      registration.ticketRequestExpiresAt.getTime() <= Date.now()
    ) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'TICKET_REQUEST_EXPIRED',
      );

      return {
        ignored: true,
        reason: 'TICKET_REQUEST_EXPIRED',
      };
    }

    /**
     * الرقم الذي أرسل رسالة WhatsApp فعليًا.
     *
     * لم نعد نقارنه مع الرقم الذي أدخله المستخدم
     * في نموذج التسجيل.
     */
    const senderPhone = this.normalizePhone(message.senderPhone);

    if (!senderPhone) {
      await this.markDelivery(delivery.id, 'REJECTED', 'SENDER_PHONE_MISSING');

      return {
        ignored: true,
        reason: 'SENDER_PHONE_MISSING',
      };
    }

    /**
     * أول حساب WhatsApp يرسل الطلب يصبح الحساب المعتمد.
     *
     * إذا كان الطلب مربوطًا مسبقًا:
     * - نفس الرقم: مسموح.
     * - رقم مختلف: مرفوض.
     */
    const senderClaimed = await this.claimTicketRequestSender({
      registrationId: registration.id,
      senderPhone,
      ticketRequestToken,
    });

    if (!senderClaimed) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'TICKET_REQUEST_ALREADY_BOUND',
      );

      return {
        ignored: true,
        reason: 'TICKET_REQUEST_ALREADY_BOUND',
      };
    }

    let image: Awaited<
      ReturnType<DigitalTicketsService['resolveUsableForRegistration']>
    >;

    try {
      image = await this.digitalTicketsService.resolveUsableForRegistration(
        registration.id,
      );
    } catch (error) {
      const reason =
        error instanceof NotFoundException
          ? 'DIGITAL_TICKET_TEMPLATE_NOT_FOUND'
          : 'DIGITAL_TICKET_UNAVAILABLE';

      await this.markDelivery(delivery.id, 'REJECTED', reason);

      return {
        ignored: true,
        reason,
      };
    }

    const imageUrl = this.resolvePublicHttpsImageUrl(
      image.imageUrl,
      image.relativePath,
    );

    if (!imageUrl) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'PUBLIC_IMAGE_URL_UNAVAILABLE',
      );

      return {
        ignored: true,
        reason: 'PUBLIC_IMAGE_URL_UNAVAILABLE',
      };
    }

    let notification: Awaited<
      ReturnType<NotificationsService['sendRegistrationTicketImage']>
    >;

    try {
      notification =
        await this.notificationsService.sendRegistrationTicketImage({
          registrationId: registration.id,
          imageUrl,
          recipient: senderPhone,
          dedupeKey: `DIGITAL_TICKET_REQUEST:${registration.id}:${message.deliveryId}`,
          locale: Locale.AR,
          forceResend: false,
        });
    } catch (error) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'NOTIFICATION_QUEUE_FAILED',
      );

      throw error;
    }

    /**
     * نسجل أن الطلب استُخدم بنجاح.
     *
     * لا نحذف الرمز ولا نمنع نفس رقم WhatsApp
     * من إعادة الطلب، فقد يحتاج إلى المحاولة مجددًا.
     */
    await this.prisma.registration.updateMany({
      where: {
        id: registration.id,
        ticketRequestToken,
        ticketRequestConsumedAt: null,
      },
      data: {
        ticketRequestConsumedAt: new Date(),
      },
    });

    await this.markDelivery(delivery.id, 'PROCESSED', undefined);

    if ('skipped' in notification) {
      return {
        ignored: true,
        reason: notification.reason,
        notificationLogId: notification.log.id,
      };
    }

    return {
      queued: notification.queued,
      jobId: notification.jobId,
      notificationLogId: notification.log.id,
    };
  }

  /**
   * ينشئ رمز طلب جديدًا ويحفظه على التسجيل.
   *
   * يتم تصفير رقم WhatsApp المرتبط لأن الرمز الجديد
   * يمثل عملية طلب جديدة.
   */
  private async persistUniqueToken(registrationId: string, expiresAt: Date) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ticketRequestToken = `WTR_${randomBytes(24).toString('base64url')}`;

      try {
        await this.prisma.registration.update({
          where: {
            id: registrationId,
          },
          data: {
            ticketRequestToken,
            ticketRequestExpiresAt: expiresAt,
            ticketRequestCreatedAt: new Date(),
            ticketRequestConsumedAt: null,

            ticketRequestPhone: null,
            ticketRequestClaimedAt: null,
          },
        });

        return ticketRequestToken;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new BadRequestException('Could not generate ticket request token');
  }

  /**
   * يربط أول حساب WhatsApp بالطلب.
   *
   * الربط يتم باستخدام updateMany مشروط لمنع حالتي
   * وصول رسالتين من رقمين مختلفين في اللحظة نفسها.
   */
  private async claimTicketRequestSender(input: ClaimTicketRequestSenderInput) {
    const now = new Date();

    const currentRegistration = await this.prisma.registration.findUnique({
      where: {
        id: input.registrationId,
      },
      select: {
        ticketRequestToken: true,
        ticketRequestExpiresAt: true,
        ticketRequestPhone: true,
      },
    });

    if (!currentRegistration) {
      return false;
    }

    if (
      !currentRegistration.ticketRequestToken ||
      !this.safeSecretEquals(
        input.ticketRequestToken,
        currentRegistration.ticketRequestToken,
      )
    ) {
      return false;
    }

    if (
      !currentRegistration.ticketRequestExpiresAt ||
      currentRegistration.ticketRequestExpiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }

    /**
     * الطلب مربوط مسبقًا.
     *
     * نسمح فقط إذا كان المرسل الحالي هو نفس
     * حساب WhatsApp المرتبط.
     */
    if (currentRegistration.ticketRequestPhone) {
      return (
        this.normalizePhone(currentRegistration.ticketRequestPhone) ===
        input.senderPhone
      );
    }

    /**
     * محاولة ربط الطلب لأول مرة.
     *
     * الشرط ticketRequestPhone: null يمنع رقمين
     * من حجز الطلب في الوقت نفسه.
     */
    const claimed = await this.prisma.registration.updateMany({
      where: {
        id: input.registrationId,
        ticketRequestToken: input.ticketRequestToken,
        ticketRequestExpiresAt: {
          gt: now,
        },
        ticketRequestPhone: null,
      },
      data: {
        ticketRequestPhone: input.senderPhone,
        ticketRequestClaimedAt: now,
      },
    });

    if (claimed.count === 1) {
      return true;
    }

    /**
     * ربما تم تنفيذ طلبين متزامنين.
     * نقرأ النتيجة النهائية ونتأكد من الرقم الذي تم ربطه.
     */
    const latestRegistration = await this.prisma.registration.findUnique({
      where: {
        id: input.registrationId,
      },
      select: {
        ticketRequestToken: true,
        ticketRequestExpiresAt: true,
        ticketRequestPhone: true,
      },
    });

    if (
      !latestRegistration?.ticketRequestPhone ||
      !latestRegistration.ticketRequestToken ||
      !latestRegistration.ticketRequestExpiresAt
    ) {
      return false;
    }

    if (latestRegistration.ticketRequestExpiresAt.getTime() <= Date.now()) {
      return false;
    }

    if (
      !this.safeSecretEquals(
        input.ticketRequestToken,
        latestRegistration.ticketRequestToken,
      )
    ) {
      return false;
    }

    return (
      this.normalizePhone(latestRegistration.ticketRequestPhone) ===
      input.senderPhone
    );
  }

  /**
   * الرسالة الجاهزة التي يرسلها الزائر.
   *
   * يجب أن يأتي الرابط من الباك كما هو.
   * لا يجب على الفرونت إعادة بناء الرسالة.
   */
  private buildWhatsAppUrl(publicId: string, ticketRequestToken: string) {
    const requestPhone = this.normalizePhone(
      this.configService.get<string>('WHATSAPP_REQUEST_PHONE', ''),
    );

    if (!requestPhone) {
      throw new BadRequestException('WHATSAPP_REQUEST_PHONE is not configured');
    }

    const message = [
      'طلب بطاقة الدخول',
      `رقم التسجيل: ${publicId}`,
      `رمز الطلب: ${ticketRequestToken}`,
    ].join('\n');

    return `https://wa.me/${requestPhone}?text=${encodeURIComponent(message)}`;
  }

  private validateWebhookSecret(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const expected = this.configService.get<string>('WASENDER_WEBHOOK_SECRET');

    if (!expected) {
      throw new UnauthorizedException(
        'WASENDER_WEBHOOK_SECRET is not configured',
      );
    }

    /**
     * Fastify يحول أسماء Headers إلى lowercase.
     *
     * Wasender قد يرسل:
     * X-Webhook-Signature
     */
    const provided =
      this.getHeader(headers, 'x-webhook-signature') ??
      this.getHeader(headers, 'x-wasender-webhook-secret') ??
      this.getHeader(headers, 'x-webhook-secret') ??
      this.getBearerToken(this.getHeader(headers, 'authorization'));

    if (!provided || !this.safeSecretEquals(provided.trim(), expected.trim())) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
  }

  private extractIncomingMessage(
    payload: Record<string, unknown>,
  ): IncomingMessage {
    /**
     * Wasender يضع بيانات الرسالة غالبًا داخل:
     *
     * data.messages
     */
    const deliveryId =
      this.firstString(payload, [
        'data.messages.key.id',

        'id',
        'messageId',
        'message_id',
        'webhookId',
        'webhook_id',
        'data.id',
        'data.messageId',
        'data.message_id',
        'data.key.id',
      ]) ?? `hash:${this.hashPayload(payload)}`;

    const text =
      this.firstString(payload, [
        'data.messages.messageBody',
        'data.messages.message.conversation',
        'data.messages.message.extendedTextMessage.text',
        'data.messages.message.imageMessage.caption',
        'data.messages.message.videoMessage.caption',
        'data.messages.message.documentMessage.caption',

        'text',
        'body',
        'message',
        'caption',
        'data.text',
        'data.body',
        'data.message',
        'data.caption',
        'data.message.conversation',
      ]) ?? '';

    const senderPhone =
      this.firstString(payload, [
        /**
         * cleanedSenderPn هو الخيار الأفضل لأنه رقم هاتف
         * وليس WhatsApp LID.
         */
        'data.messages.key.cleanedSenderPn',
        'data.messages.key.senderPn',

        'data.messages.key.remoteJid',

        'from',
        'sender',
        'senderPhone',
        'phone',
        'remoteJid',
        'data.from',
        'data.sender',
        'data.senderPhone',
        'data.phone',
        'data.remoteJid',
        'data.key.remoteJid',
      ]) ?? '';

    const remoteJid =
      this.firstString(payload, [
        'data.messages.key.remoteJid',
        'remoteJid',
        'chatId',
        'data.remoteJid',
        'data.chatId',
        'data.key.remoteJid',
      ]) ?? senderPhone;

    const eventType =
      this.firstString(payload, [
        'event',
        'eventType',
        'event_type',
        'type',
        'data.event',
        'data.eventType',
        'data.event_type',
        'data.type',
      ])?.toLowerCase() ?? '';

    const outgoing =
      this.firstBoolean(payload, [
        'data.messages.key.fromMe',

        'fromMe',
        'isFromMe',
        'outgoing',
        'isOutgoing',
        'data.fromMe',
        'data.isFromMe',
        'data.outgoing',
        'data.isOutgoing',
        'data.key.fromMe',
      ]) === true ||
      this.firstString(payload, [
        'direction',
        'data.direction',
      ])?.toLowerCase() === 'outgoing';

    const group =
      this.firstBoolean(payload, [
        'data.messages.isGroup',
        'data.messages.key.isGroup',
        'isGroup',
        'data.isGroup',
      ]) === true || remoteJid.toLowerCase().includes('@g.us');

    return {
      deliveryId,
      eventType,
      text,
      senderPhone,
      outgoing,
      group,
    };
  }

  private extractPublicId(text: string) {
    const match = text.match(this.publicIdPattern);

    return match?.[1].toUpperCase();
  }

  private extractTicketRequestToken(text: string) {
    const match = text.match(this.ticketRequestTokenPattern);

    return match?.[1];
  }

  private async recordDelivery(
    deliveryId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      const created = await this.prisma.webhookDelivery.create({
        data: {
          provider: 'WASENDER',
          deliveryId,
          status: 'RECEIVED',
          payload: payload as Prisma.InputJsonValue,
        },
      });

      return {
        id: created.id,
        duplicate: false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          id: '',
          duplicate: true,
        };
      }

      throw error;
    }
  }

  private async markDelivery(
    id: string,
    status: string,
    reason: string | undefined,
  ) {
    if (!id) {
      return;
    }

    await this.prisma.webhookDelivery.update({
      where: {
        id,
      },
      data: {
        status,
        reason,
        processedAt: new Date(),
      },
    });
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ) {
    const direct = headers[key] ?? headers[key.toLowerCase()];

    const value = Array.isArray(direct) ? direct[0] : direct;

    return typeof value === 'string' ? value : undefined;
  }

  private getBearerToken(value?: string) {
    if (!value) {
      return undefined;
    }

    const match = value.match(/^Bearer\s+(.+)$/i);

    return match?.[1]?.trim();
  }

  private firstString(payload: Record<string, unknown>, paths: string[]) {
    for (const path of paths) {
      const value = this.readPath(payload, path);

      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private firstBoolean(payload: Record<string, unknown>, paths: string[]) {
    for (const path of paths) {
      const value = this.readPath(payload, path);

      if (typeof value === 'boolean') {
        return value;
      }
    }

    return undefined;
  }

  private readPath(payload: Record<string, unknown>, path: string) {
    return path.split('.').reduce<unknown>((current, part) => {
      if (
        typeof current !== 'object' ||
        current === null ||
        Array.isArray(current)
      ) {
        return undefined;
      }

      return (current as Record<string, unknown>)[part];
    }, payload);
  }

  private normalizePhone(value?: string | null) {
    return (value ?? '')
      .replace(/@(?:s\.whatsapp\.net|c\.us)$/i, '')
      .replace(/\D/g, '');
  }

  private resolvePublicHttpsImageUrl(
    imageUrl: string | null | undefined,
    relativePath: string | null | undefined,
  ) {
    const configuredBase = this.configService
      .get<string>('APP_PUBLIC_BASE_URL', '')
      .replace(/\/+$/, '');

    const candidate =
      configuredBase && relativePath
        ? `${configuredBase}/${relativePath.replace(/^\/+/, '')}`
        : imageUrl;

    if (!candidate) {
      return null;
    }

    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();

      const isLocalHostname = [
        'localhost',
        '127.0.0.1',
        '::1',
        '[::1]',
      ].includes(hostname);

      if (parsed.protocol !== 'https:' || isLocalHostname) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private safeSecretEquals(provided: string, expected: string) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
