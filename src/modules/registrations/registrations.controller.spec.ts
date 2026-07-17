import { RegistrationSource } from '@prisma/client';
import { RegistrationsController } from './registrations.controller';

describe('RegistrationsController', () => {
  it('wraps admin-created registration with digitalTicket status', async () => {
    const registration = {
      id: 'registration-1',
      publicId: 'REG_ADMIN',
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
      status: 'ACTIVE',
      fullName: 'Admin Visitor',
      phone: '+963944000000',
      email: null,
      source: RegistrationSource.ADMIN,
    };
    const registrationsService = {
      create: jest.fn().mockResolvedValue(registration),
    };
    const digitalTicketStatusService = {
      resolveForRegistration: jest.fn().mockResolvedValue({
        status: 'PENDING',
        imageUrl: null,
        relativePath: null,
        generatedAt: null,
        templateVersion: null,
        pollUrl: null,
      }),
    };
    const controller = new RegistrationsController(
      digitalTicketStatusService as never,
      registrationsService as never,
    );

    await expect(
      controller.create({
        eventId: 'event-1',
        attendeeTypeId: 'attendee-1',
        fullName: 'Admin Visitor',
        phone: '+963944000000',
      }),
    ).resolves.toEqual({
      registration,
      digitalTicket: {
        status: 'PENDING',
        imageUrl: null,
        relativePath: null,
        generatedAt: null,
        templateVersion: null,
        pollUrl: null,
      },
    });
    expect(digitalTicketStatusService.resolveForRegistration).toHaveBeenCalledWith({
      registration,
      includePollUrl: false,
    });
  });
});
