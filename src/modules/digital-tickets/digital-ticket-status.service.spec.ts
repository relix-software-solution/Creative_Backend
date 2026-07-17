import { DigitalTicketStatusService } from './digital-ticket-status.service';

function createService() {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        API_PREFIX: 'api/v1',
        APP_PUBLIC_BASE_URL: 'https://api.example.com',
      };

      return values[key] ?? fallback;
    }),
  };
  const imageService = {
    isGeneratedImageUsable: jest.fn().mockResolvedValue(true),
  };
  const prisma = {
    digitalTicketTemplate: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'template-1', attendeeTypeId: 'attendee-1', version: 3 },
      ]),
    },
    digitalTicketImage: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const registration = {
    id: 'registration-1',
    publicId: 'REG_PUBLIC',
    eventId: 'event-1',
    attendeeTypeId: 'attendee-1',
    source: 'PUBLIC',
  };

  return {
    config,
    imageService,
    prisma,
    queue,
    registration,
    service: new DigitalTicketStatusService(
      config as never,
      imageService as never,
      prisma as never,
      queue as never,
    ),
  };
}

describe('DigitalTicketStatusService', () => {
  it('returns READY only when an existing image row points to a usable file', async () => {
    const { prisma, registration, service } = createService();
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce({
      imageUrl: 'http://localhost:3000/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
      generatedAt: new Date('2026-08-02T09:00:00.000Z'),
      templateVersion: 3,
    });

    await expect(
      service.resolveForRegistration({ registration, accessToken: 'token' }),
    ).resolves.toEqual({
      status: 'READY',
      imageUrl: 'https://api.example.com/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
      generatedAt: '2026-08-02T09:00:00.000Z',
      templateVersion: 3,
      pollUrl: null,
    });
  });

  it('returns PENDING and queues regeneration when an existing image file is unusable', async () => {
    const { imageService, prisma, queue, registration, service } = createService();
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce({
      imageUrl: 'https://api.example.com/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
      generatedAt: new Date(),
      templateVersion: 3,
    });
    imageService.isGeneratedImageUsable.mockResolvedValueOnce(false);

    await expect(
      service.resolveForRegistration({
        registration,
        accessToken: 'poll-token',
      }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      imageUrl: null,
      pollUrl:
        '/api/v1/public/registrations/REG_PUBLIC/digital-ticket?token=poll-token',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'registration.created',
      expect.objectContaining({ registrationId: 'registration-1' }),
      expect.any(Object),
    );
  });

  it('returns NOT_CONFIGURED when no active template applies', async () => {
    const { prisma, registration, service } = createService();
    prisma.digitalTicketTemplate.findMany.mockResolvedValueOnce([]);

    await expect(
      service.resolveForRegistration({ registration, accessToken: 'token' }),
    ).resolves.toMatchObject({
      status: 'NOT_CONFIGURED',
      imageUrl: null,
      pollUrl: null,
    });
  });
});
