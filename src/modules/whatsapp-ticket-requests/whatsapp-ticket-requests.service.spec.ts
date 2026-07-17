import { NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { WhatsappTicketRequestsService } from './whatsapp-ticket-requests.service';

describe('WhatsappTicketRequestsService', () => {
  const registration = {
    id: 'registration-1',
    publicId: 'REG_CC49508E58A7E4CA',
    status: RegistrationStatus.ACTIVE,
    phone: '+963 (944) 777-001',
  };
  const image = {
    id: 'ticket-image-1',
    imageUrl: 'http://localhost:3000/uploads/digital-tickets/generated/ticket.png',
    relativePath: '/uploads/digital-tickets/generated/ticket.png',
  };

  let configService: any;
  let digitalTicketsService: any;
  let notificationsService: any;
  let prisma: any;
  let service: WhatsappTicketRequestsService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          APP_PUBLIC_BASE_URL: 'https://api.example.com',
          WASENDER_WEBHOOK_SECRET: 'webhook-secret',
          WHATSAPP_REQUEST_PHONE: '+963 900 000 000',
          WHATSAPP_TICKET_REQUEST_EXPIRES_HOURS: 24,
        };

        return values[key] ?? fallback;
      }),
    };
    digitalTicketsService = {
      resolveUsableForRegistration: jest.fn().mockResolvedValue(image),
    };
    notificationsService = {
      sendRegistrationTicketImage: jest.fn().mockResolvedValue({
        queued: true,
        jobId: 'whatsapp:notification-1',
        log: { id: 'notification-1' },
      }),
    };
    prisma = {
      registration: {
        findUnique: jest.fn().mockResolvedValue(registration),
        update: jest.fn().mockResolvedValue(registration),
      },
      webhookDelivery: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `delivery-row-${data.deliveryId}`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new WhatsappTicketRequestsService(
      configService,
      digitalTicketsService,
      notificationsService,
      prisma,
    );
  });

  const headers = { 'x-wasender-webhook-secret': 'webhook-secret' };

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      event: 'messages.received',
      id: 'provider-message-1',
      from: '963944777001@s.whatsapp.net',
      fromMe: false,
      isGroup: false,
      body: `Request entry ticket\n${registration.publicId}`,
      ...overrides,
    };
  }

  it('prepares an Arabic WhatsApp message containing publicId without the legacy token', async () => {
    const result = await service.createForRegistration(registration.id);
    const message = decodeURIComponent(new URL(result.url).searchParams.get('text') ?? '');

    expect(message).toBe(`\u0637\u0644\u0628 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062f\u062e\u0648\u0644\n${registration.publicId}`);
    expect(message).not.toContain(result.ticketRequestToken);
    expect(message).not.toContain(registration.id);
  });

  it.each([
    `\u0637\u0644\u0628 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062f\u062e\u0648\u0644\n${registration.publicId}`,
    `Please send ${registration.publicId} - Request entry ticket`,
  ])('extracts publicId and queues the existing ticket-image notification', async (body) => {
    await expect(service.handleWasenderWebhook(headers, payload({ body }))).resolves.toMatchObject({
      queued: true,
      notificationLogId: 'notification-1',
    });

    expect(prisma.registration.findUnique).toHaveBeenCalledWith({
      where: { publicId: registration.publicId },
    });
    expect(notificationsService.sendRegistrationTicketImage).toHaveBeenCalledWith({
      registrationId: registration.id,
      imageUrl: 'https://api.example.com/uploads/digital-tickets/generated/ticket.png',
      recipient: '963944777001',
      dedupeKey: `DIGITAL_TICKET_REQUEST:${registration.id}:provider-message-1`,
      locale: 'AR',
      forceResend: false,
    });
  });

  it('rejects a mismatched sender without sending', async () => {
    const result = await service.handleWasenderWebhook(
      headers,
      payload({ from: '+963944000999' }),
    );

    expect(result).toEqual({ ignored: true, reason: 'PHONE_MISMATCH' });
    expect(notificationsService.sendRegistrationTicketImage).not.toHaveBeenCalled();
  });

  it.each([
    [{ isGroup: true }, 'GROUP_MESSAGE'],
    [{ fromMe: true }, 'OUTGOING_MESSAGE'],
    [{ body: 'Request entry ticket' }, 'PUBLIC_ID_NOT_FOUND'],
    [{ event: 'messages.updated' }, 'UNSUPPORTED_EVENT'],
  ])('acknowledges ignored or invalid messages without sending', async (overrides, reason) => {
    const result = await service.handleWasenderWebhook(headers, payload(overrides));

    expect(result).toEqual({ ignored: true, reason });
    expect(notificationsService.sendRegistrationTicketImage).not.toHaveBeenCalled();
  });

  it('deduplicates duplicate provider message deliveries', async () => {
    prisma.webhookDelivery.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.handleWasenderWebhook(headers, payload())).resolves.toEqual({
      ignored: true,
      reason: 'DUPLICATE_WEBHOOK_DELIVERY',
    });
    expect(notificationsService.sendRegistrationTicketImage).not.toHaveBeenCalled();
  });

  it('allows a distinct later inbound message to request a resend', async () => {
    await service.handleWasenderWebhook(headers, payload());
    await service.handleWasenderWebhook(
      headers,
      payload({ id: 'provider-message-2' }),
    );

    expect(notificationsService.sendRegistrationTicketImage).toHaveBeenCalledTimes(2);
    expect(notificationsService.sendRegistrationTicketImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dedupeKey: `DIGITAL_TICKET_REQUEST:${registration.id}:provider-message-2`,
      }),
    );
  });

  it('does not send a QR fallback when no active ticket template exists', async () => {
    digitalTicketsService.resolveUsableForRegistration.mockRejectedValueOnce(
      new NotFoundException('Active digital ticket template not found'),
    );

    await expect(service.handleWasenderWebhook(headers, payload())).resolves.toEqual({
      ignored: true,
      reason: 'DIGITAL_TICKET_TEMPLATE_NOT_FOUND',
    });
    expect(notificationsService.sendRegistrationTicketImage).not.toHaveBeenCalled();
  });
});
