import { BadRequestException } from '@nestjs/common';
import { EventStatus, RegistrationSource } from '@prisma/client';
import { RegistrationsService } from './registrations.service';

describe('RegistrationsService validation', () => {
  const createService = () => {
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-1',
          status: EventStatus.ACTIVE,
          duplicateStrategy: 'PHONE',
        }),
      },
      attendeeType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attendee-type-1',
          eventId: 'event-1',
          isActive: true,
        }),
      },
      registration: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'registration-1',
            status: 'ACTIVE',
            ...data,
          }),
        ),
      },
      registrationField: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const configService = {
      get: jest.fn().mockReturnValue(false),
    };
    const queue = {
      add: jest.fn(),
    };

    return {
      prisma,
      service: new RegistrationsService(
        configService as never,
        queue as never,
        prisma as never,
      ),
    };
  };

  it('creates a registration without email and persists email as null', async () => {
    const { prisma, service } = createService();

    const registration = await service.create({
      eventId: 'event-1',
      attendeeTypeId: 'attendee-type-1',
      fullName: ' Ahmad Ali ',
      phone: ' +963944111111 ',
      source: RegistrationSource.ADMIN,
    });

    expect(registration.email).toBeNull();
    expect(registration.fullName).toBe('Ahmad Ali');
    expect(registration.phone).toBe('+963944111111');
    expect(prisma.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: null,
          fullName: 'Ahmad Ali',
          phone: '+963944111111',
        }),
      }),
    );
  });

  it('rejects a registration without phone', async () => {
    const { service } = createService();

    await expect(
      service.create({
        eventId: 'event-1',
        attendeeTypeId: 'attendee-type-1',
        fullName: 'Ahmad Ali',
        phone: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
