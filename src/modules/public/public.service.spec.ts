import { GoneException, UnauthorizedException } from '@nestjs/common';
import { RegistrationSource } from '@prisma/client';
import { PublicService } from './public.service';

function createRegistration() {
  return {
    id: 'registration-1',
    publicId: 'REG_PUBLIC',
    eventId: 'event-1',
    attendeeTypeId: 'attendee-1',
    status: 'ACTIVE',
    fullName: 'Visitor One',
    phone: '+963944000000',
    email: null,
    companyName: null,
    jobTitle: null,
    source: RegistrationSource.PUBLIC,
  };
}

function createService() {
  const registration = createRegistration();
  const prisma = {
    event: {
      findUnique: jest.fn().mockResolvedValue({ id: 'event-1', isActive: true }),
    },
    registration: {
      findUnique: jest.fn().mockResolvedValue({
        ...registration,
        ticketRequestToken: 'poll-token',
        ticketRequestExpiresAt: new Date(Date.now() + 60_000),
      }),
    },
    digitalTicketTemplate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'template-1' }),
    },
  };
  const digitalTicketStatusService = {
    resolveForRegistration: jest.fn().mockResolvedValue({
      status: 'PENDING',
      imageUrl: null,
      relativePath: null,
      generatedAt: null,
      templateVersion: null,
      pollUrl:
        '/api/v1/public/registrations/REG_PUBLIC/digital-ticket?token=poll-token',
    }),
  };
  const registrationsService = {
    create: jest.fn().mockResolvedValue(registration),
  };
  const digitalTicketsService = {
    generateForRegistration: jest.fn().mockResolvedValue({
      id: 'ticket-image-1',
      imageUrl:
        'https://api.example.com/uploads/digital-tickets/generated/ticket.png',
      relativePath: '/uploads/digital-tickets/generated/ticket.png',
      generatedAt: new Date('2026-08-02T09:00:00.000Z'),
      templateVersion: 3,
    }),
  };
  const whatsappTicketRequestsService = {
    createForRegistration: jest.fn().mockResolvedValue({
      enabled: true,
      ticketRequestToken: 'poll-token',
      url: 'https://wa.me/963900000000?text=Request',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  };
  const service = new PublicService(
    prisma as never,
    {} as never,
    {} as never,
    digitalTicketStatusService as never,
    digitalTicketsService as never,
    registrationsService as never,
    whatsappTicketRequestsService as never,
  );

  return {
    digitalTicketStatusService,
    digitalTicketsService,
    prisma,
    registration,
    registrationsService,
    service,
    whatsappTicketRequestsService,
  };
}

describe('PublicService Phase 4 registration response', () => {
  it('returns registration, digitalTicket, and whatsappRequest without QR secrets', async () => {
    const {
      registrationsService,
      service,
      whatsappTicketRequestsService,
    } = createService();

    const result = await service.register('event-1', {
      attendeeTypeId: 'attendee-1',
      fullName: 'Visitor One',
      phone: '+963944000000',
    });

    expect(registrationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        source: RegistrationSource.PUBLIC,
      }),
    );
    expect(whatsappTicketRequestsService.createForRegistration).toHaveBeenCalledWith(
      'registration-1',
    );
    expect(result).toMatchObject({
      registration: {
        publicId: 'REG_PUBLIC',
        eventId: 'event-1',
        fullName: 'Visitor One',
        phone: '+963944000000',
        email: null,
        status: 'ACTIVE',
      },
      digitalTicket: {
        status: 'READY',
        imageUrl:
          'https://api.example.com/uploads/digital-tickets/generated/ticket.png',
        pollUrl: null,
      },
      whatsappRequest: {
        enabled: true,
        url: 'https://wa.me/963900000000?text=Request',
      },
    });
    expect(JSON.stringify(result)).not.toContain('qrToken');
    expect(JSON.stringify(result)).not.toContain('ticketRequestToken');
    expect(result.registration).not.toHaveProperty('id');
  });

  it('returns whatsappRequest disabled when request-link creation fails', async () => {
    const { service, whatsappTicketRequestsService } =
      createService();
    whatsappTicketRequestsService.createForRegistration.mockRejectedValueOnce(
      new Error('missing config'),
    );
    await expect(
      service.register('event-1', {
        attendeeTypeId: 'attendee-1',
        fullName: 'Visitor One',
        phone: '+963944000000',
      }),
    ).resolves.toMatchObject({
      whatsappRequest: {
        enabled: false,
        url: null,
        expiresAt: null,
      },
      digitalTicket: {
        status: 'READY',
        pollUrl: null,
      },
    });
  });

  it('poll endpoint rejects invalid and expired access tokens', async () => {
    const { prisma, service } = createService();

    await expect(
      service.findDigitalTicket('REG_PUBLIC', 'bad-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.registration.findUnique.mockResolvedValueOnce({
      ...createRegistration(),
      ticketRequestToken: 'poll-token',
      ticketRequestExpiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      service.findDigitalTicket('REG_PUBLIC', 'poll-token'),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('poll endpoint returns status without private registration fields', async () => {
    const { digitalTicketStatusService, service } = createService();
    digitalTicketStatusService.resolveForRegistration.mockResolvedValueOnce({
      status: 'READY',
      imageUrl: 'https://api.example.com/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
      generatedAt: '2026-08-02T09:00:00.000Z',
      templateVersion: 3,
      pollUrl: null,
    });

    const result = await service.findDigitalTicket('REG_PUBLIC', 'poll-token');

    expect(result).toEqual({
      status: 'READY',
      imageUrl: 'https://api.example.com/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
      generatedAt: '2026-08-02T09:00:00.000Z',
      templateVersion: 3,
    });
    expect(JSON.stringify(result)).not.toContain('+963');
    expect(JSON.stringify(result)).not.toContain('qrToken');
  });
});
