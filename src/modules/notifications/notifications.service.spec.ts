import {
  Locale,
  NotificationChannel,
  NotificationProvider,
  NotificationStatus,
  NotificationTemplateType,
  RegistrationStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';
import { WhatsAppProviderError } from './providers/whatsapp-provider.error';

describe('NotificationsService WhatsApp reliability', () => {
  const registration = {
    id: 'reg_1',
    eventId: 'event_1',
    publicId: 'REG_1',
    status: RegistrationStatus.ACTIVE,
    fullName: 'Visitor One',
    phone: '+963900000000',
    event: { id: 'event_1', titleAr: 'Event AR' },
    attendeeType: { id: 'att_1' },
    qrToken: null,
  };
  const log = {
    id: 'log_1',
    eventId: registration.eventId,
    registrationId: registration.id,
    templateId: 'tpl_1',
    notificationType: NotificationTemplateType.REGISTRATION_QR,
    dedupeKey: 'REGISTRATION_QR:event_1:reg_1',
    channel: NotificationChannel.WHATSAPP,
    provider: NotificationProvider.FAKE,
    recipient: registration.phone,
    status: NotificationStatus.PENDING,
    subject: null,
    content: 'hello',
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    metadata: { attempts: 0 },
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let prisma: any;
  let queue: any;
  let service: NotificationsService;

  beforeEach(() => {
    jest.restoreAllMocks();
    prisma = {
      registration: {
        findUnique: jest.fn().mockResolvedValue(registration),
      },
      notificationTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tpl_1',
          content: 'Hi {{fullName}} {{qrLink}}',
        }),
      },
      notificationLog: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(log),
        update: jest.fn().mockImplementation(({ data }) => ({
          ...log,
          ...data,
        })),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue({ id: 'whatsapp:log_1' }),
    };
    service = new NotificationsService(
      {
        get: jest.fn((key: string, fallback?: unknown) => {
          const values: Record<string, unknown> = {
            WHATSAPP_PROVIDER: NotificationProvider.FAKE,
            APP_PUBLIC_BASE_URL: 'https://example.com',
            WHATSAPP_SEND_MAX_ATTEMPTS: 5,
            WHATSAPP_SEND_RETRY_BACKOFF_MS: 5000,
          };

          return values[key] ?? fallback;
        }),
      } as never,
      queue,
      prisma,
      {
        generateRegistrationQrImage: jest.fn().mockResolvedValue({
          publicUrl: 'https://example.com/uploads/qr/REG_1.png',
        }),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({ qrToken: 'signed.qr' }),
        findByRegistration: jest
          .fn()
          .mockResolvedValue({ qrToken: 'signed.qr' }),
      } as never,
    );
  });

  it('does not duplicate an existing PENDING notification', async () => {
    prisma.notificationLog.findUnique.mockResolvedValueOnce(log);

    const result = await service.sendRegistrationQr({
      registrationId: registration.id,
    });

    expect(result).toMatchObject({ skipped: true, reason: 'NOTIFICATION_PENDING' });
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([NotificationStatus.SENT, NotificationStatus.DELIVERED])(
    'does not duplicate an existing %s notification',
    async (status) => {
      prisma.notificationLog.findUnique.mockResolvedValueOnce({
        ...log,
        status,
      });

      const result = await service.sendRegistrationQr({
        registrationId: registration.id,
      });

      expect(result).toMatchObject({ skipped: true, reason: `NOTIFICATION_${status}` });
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('uses a deterministic BullMQ job ID', async () => {
    await service.sendRegistrationQr({ registrationId: registration.id });

    expect(queue.add).toHaveBeenCalledWith(
      'whatsapp.send',
      { notificationLogId: log.id, manualRetry: false },
      expect.objectContaining({ jobId: `whatsapp:${log.id}` }),
    );
  });

  it('marks the log FAILED when enqueue fails', async () => {
    queue.add.mockRejectedValueOnce(new Error('Redis down'));

    const result = await service.sendRegistrationQr({
      registrationId: registration.id,
    });

    expect(result).toMatchObject({ queued: false });
    expect(prisma.notificationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: log.id },
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
          errorCode: 'WHATSAPP_ENQUEUE_FAILED',
        }),
      }),
    );
  });

  it('reuses the same failed log for retry', async () => {
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      status: NotificationStatus.FAILED,
    });

    const result = await service.retryLog(log.id);

    expect(result).toMatchObject({ queued: true, logId: log.id });
    expect(queue.add).toHaveBeenCalledWith(
      'whatsapp.send',
      { notificationLogId: log.id, manualRetry: true },
      expect.objectContaining({ jobId: `whatsapp:${log.id}` }),
    );
  });

  it('force resend creates a versioned dedupe key', async () => {
    await service.sendRegistrationQr({
      registrationId: registration.id,
      forceResend: true,
    });

    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: expect.stringMatching(
            /^REGISTRATION_QR:event_1:reg_1:resend:\d+$/,
          ),
        }),
      }),
    );
  });

  it('handles concurrent create races by re-reading the existing dedupe log', async () => {
    prisma.notificationLog.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.notificationLog.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(log);

    const result = await service.sendRegistrationQr({
      registrationId: registration.id,
    });

    expect(result).toMatchObject({ queued: true, log });
  });

  it('marks final QR image failure as FAILED', async () => {
    (service as any).qrImageService.generateRegistrationQrImage.mockRejectedValueOnce(
      new Error('disk full'),
    );
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      registration,
    });

    await service.deliverQueuedWhatsApp({
      notificationLogId: log.id,
      attemptNumber: 5,
      isFinalAttempt: true,
    });

    expect(prisma.notificationLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: log.id },
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
          errorCode: 'WHATSAPP_SEND_FAILED',
        }),
      }),
    );
  });

  it('queues a registration ticket image with existing notification dedupe', async () => {
    const result = await service.sendRegistrationTicketImage({
      registrationId: registration.id,
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/ticket.png',
    });

    expect(result).toMatchObject({ queued: true });
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: 'REGISTRATION_QR:event_1:reg_1',
          metadata: expect.objectContaining({
            mediaType: 'DIGITAL_TICKET',
            imageUrl:
              'https://example.com/uploads/digital-tickets/generated/ticket.png',
          }),
        }),
      }),
    );
  });

  it('uses the verified webhook sender and per-message ticket request dedupe key', async () => {
    await service.sendRegistrationTicketImage({
      registrationId: registration.id,
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/ticket.png',
      recipient: '963900000000',
      dedupeKey: 'DIGITAL_TICKET_REQUEST:reg_1:provider-message-1',
    });

    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient: '963900000000',
          dedupeKey: 'DIGITAL_TICKET_REQUEST:reg_1:provider-message-1',
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'whatsapp.send',
      { notificationLogId: log.id, manualRetry: false },
      expect.objectContaining({ jobId: `whatsapp:${log.id}` }),
    );
  });

  it('uses ticket image metadata when delivering WhatsApp', async () => {
    const sendWhatsAppMessage = jest.fn().mockResolvedValue({
      provider: NotificationProvider.FAKE,
      providerMessageId: 'provider-1',
      raw: {},
    });
    jest.spyOn(WhatsAppProviderFactory.prototype, 'create').mockReturnValue({
      sendWhatsAppMessage,
    });
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      metadata: {
        imageUrl:
          'https://example.com/uploads/digital-tickets/generated/ticket.png',
      },
      registration,
    });

    await service.deliverQueuedWhatsApp({
      notificationLogId: log.id,
      attemptNumber: 1,
      isFinalAttempt: false,
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl:
          'https://example.com/uploads/digital-tickets/generated/ticket.png',
      }),
    );
    expect(
      (service as any).qrImageService.generateRegistrationQrImage,
    ).not.toHaveBeenCalled();
  });

  it('falls back to QR image when no ticket image metadata exists', async () => {
    const sendWhatsAppMessage = jest.fn().mockResolvedValue({
      provider: NotificationProvider.FAKE,
      providerMessageId: 'provider-1',
      raw: {},
    });
    jest.spyOn(WhatsAppProviderFactory.prototype, 'create').mockReturnValue({
      sendWhatsAppMessage,
    });
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      metadata: {},
      registration,
    });

    await service.deliverQueuedWhatsApp({
      notificationLogId: log.id,
      attemptNumber: 1,
      isFinalAttempt: false,
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://example.com/uploads/qr/REG_1.png',
      }),
    );
  });

  it('treats permanent provider failures as final failures', async () => {
    jest.spyOn(WhatsAppProviderFactory.prototype, 'create').mockReturnValue({
      sendWhatsAppMessage: jest.fn().mockRejectedValue(
        new WhatsAppProviderError('bad request', 'WHATSAPP_PERMANENT_FAILURE', {
          permanent: true,
          retryable: false,
          statusCode: 400,
        }),
      ),
    });
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      registration,
    });

    await expect(
      service.deliverQueuedWhatsApp({
        notificationLogId: log.id,
        attemptNumber: 1,
        isFinalAttempt: false,
      }),
    ).rejects.toThrow('bad request');

    expect(prisma.notificationLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
          errorCode: 'WHATSAPP_PERMANENT_FAILURE',
        }),
      }),
    );
  });

  it('keeps retryable 429 failures pending before final attempt', async () => {
    jest.spyOn(WhatsAppProviderFactory.prototype, 'create').mockReturnValue({
      sendWhatsAppMessage: jest.fn().mockRejectedValue(
        new WhatsAppProviderError('rate limited', 'WHATSAPP_RATE_LIMITED', {
          retryable: true,
          permanent: false,
          statusCode: 429,
          retryAfterMs: 1000,
        }),
      ),
    });
    prisma.notificationLog.findUnique.mockResolvedValueOnce({
      ...log,
      registration,
    });

    await expect(
      service.deliverQueuedWhatsApp({
        notificationLogId: log.id,
        attemptNumber: 1,
        isFinalAttempt: false,
      }),
    ).rejects.toThrow('rate limited');

    expect(prisma.notificationLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationStatus.PENDING,
          errorCode: 'WHATSAPP_RATE_LIMITED',
        }),
      }),
    );
  });
});
