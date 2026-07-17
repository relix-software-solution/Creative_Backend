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

@Injectable()
export class WhatsappTicketRequestsService {
  private readonly publicIdPattern =
    /(?:^|[^A-Z0-9_-])(REG_[A-Z0-9_-]{1,60})(?![A-Z0-9_-])/i;

  constructor(
    private readonly configService: ConfigService,
    private readonly digitalTicketsService: DigitalTicketsService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  async createForRegistration(registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: { publicId: true },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    const expiresAt = new Date(
      Date.now() +
        this.configService.get<number>(
          'WHATSAPP_TICKET_REQUEST_EXPIRES_HOURS',
          24,
        ) *
          60 *
          60 *
          1000,
    );
    const ticketRequestToken = await this.persistUniqueToken(
      registrationId,
      expiresAt,
    );

    return {
      enabled: true,
      ticketRequestToken,
      url: this.buildWhatsAppUrl(registration.publicId),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async handleWasenderWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: Record<string, unknown>,
  ): Promise<WasenderWebhookResult> {
    this.validateWebhookSecret(headers);

    const message = this.extractIncomingMessage(payload);
    const delivery = await this.recordDelivery(message.deliveryId, payload);

    if (delivery.duplicate) {
      return { ignored: true, reason: 'DUPLICATE_WEBHOOK_DELIVERY' };
    }

    if (message.eventType !== 'messages.received') {
      await this.markDelivery(delivery.id, 'IGNORED', 'UNSUPPORTED_EVENT');
      return { ignored: true, reason: 'UNSUPPORTED_EVENT' };
    }

    if (message.outgoing) {
      await this.markDelivery(delivery.id, 'IGNORED', 'OUTGOING_MESSAGE');
      return { ignored: true, reason: 'OUTGOING_MESSAGE' };
    }

    if (message.group) {
      await this.markDelivery(delivery.id, 'IGNORED', 'GROUP_MESSAGE');
      return { ignored: true, reason: 'GROUP_MESSAGE' };
    }

    const publicId = this.extractPublicId(message.text);
    if (!publicId) {
      await this.markDelivery(delivery.id, 'REJECTED', 'PUBLIC_ID_NOT_FOUND');
      return { ignored: true, reason: 'PUBLIC_ID_NOT_FOUND' };
    }

    const registration = await this.prisma.registration.findUnique({
      where: { publicId },
    });

    if (!registration) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'REGISTRATION_NOT_FOUND',
      );
      return { ignored: true, reason: 'REGISTRATION_NOT_FOUND' };
    }

    if (registration.status !== RegistrationStatus.ACTIVE) {
      await this.markDelivery(delivery.id, 'REJECTED', 'REGISTRATION_INACTIVE');
      return { ignored: true, reason: 'REGISTRATION_INACTIVE' };
    }

    if (!registration.phone) {
      await this.markDelivery(
        delivery.id,
        'REJECTED',
        'REGISTRATION_PHONE_MISSING',
      );
      return { ignored: true, reason: 'REGISTRATION_PHONE_MISSING' };
    }

    const senderPhone = this.normalizePhone(message.senderPhone);
    if (
      !senderPhone ||
      senderPhone !== this.normalizePhone(registration.phone)
    ) {
      await this.markDelivery(delivery.id, 'REJECTED', 'PHONE_MISMATCH');
      return { ignored: true, reason: 'PHONE_MISMATCH' };
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
      return { ignored: true, reason };
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
      return { ignored: true, reason: 'PUBLIC_IMAGE_URL_UNAVAILABLE' };
    }

    const notification =
      await this.notificationsService.sendRegistrationTicketImage({
        registrationId: registration.id,
        imageUrl,
        recipient: senderPhone,
        dedupeKey: `DIGITAL_TICKET_REQUEST:${registration.id}:${message.deliveryId}`,
        locale: Locale.AR,
        forceResend: false,
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

  private async persistUniqueToken(registrationId: string, expiresAt: Date) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ticketRequestToken = randomBytes(32).toString('base64url');

      try {
        await (this.prisma.registration as any).update({
          where: { id: registrationId },
          data: {
            ticketRequestToken,
            ticketRequestExpiresAt: expiresAt,
            ticketRequestCreatedAt: new Date(),
            ticketRequestConsumedAt: null,
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

  private buildWhatsAppUrl(publicId: string) {
    const requestPhone = this.normalizePhone(
      this.configService.get<string>('WHATSAPP_REQUEST_PHONE', ''),
    );
    const message = `\u0637\u0644\u0628 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062f\u062e\u0648\u0644\n${publicId}`;
    const recipientPath = requestPhone ? `/${requestPhone}` : '';

    return `https://wa.me${recipientPath}?text=${encodeURIComponent(message)}`;
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
     * Fastify يحول أسماء الـ Headers إلى lowercase.
     *
     * Wasender يرسل:
     * X-Webhook-Signature
     *
     * لذلك نقرأ:
     * x-webhook-signature
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
     * Wasender يضع بيانات الرسالة داخل:
     *
     * data.messages
     *
     * وليس مباشرة داخل data.
     */
    const deliveryId =
      this.firstString(payload, [
        'data.messages.key.id',

        /**
         * Fallbacks لدعم أي Payload قديم أو مختلف.
         */
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
        /**
         * المسارات الأساسية في Wasender.
         */
        'data.messages.messageBody',
        'data.messages.message.conversation',
        'data.messages.message.extendedTextMessage.text',
        'data.messages.message.imageMessage.caption',
        'data.messages.message.videoMessage.caption',
        'data.messages.message.documentMessage.caption',

        /**
         * Fallbacks للمخططات القديمة.
         */
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
         * cleanedSenderPn هو الأفضل لأنه رقم جاهز
         * وليس WhatsApp LID.
         */
        'data.messages.key.cleanedSenderPn',
        'data.messages.key.senderPn',

        /**
         * Fallback إلى remoteJid فقط عند عدم وجود
         * cleanedSenderPn أو senderPn.
         */
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

  private async recordDelivery(
    deliveryId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      const created = await (this.prisma as any).webhookDelivery.create({
        data: {
          provider: 'WASENDER',
          deliveryId,
          status: 'RECEIVED',
          payload: payload as Prisma.InputJsonValue,
        },
      });

      return { id: created.id as string, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { id: '', duplicate: true };
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

    await (this.prisma as any).webhookDelivery.update({
      where: { id },
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
    if (!value?.startsWith('Bearer ')) {
      return undefined;
    }

    return value.slice('Bearer '.length);
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

      return parsed.protocol === 'https:' &&
        !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
        ? parsed.toString()
        : null;
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
