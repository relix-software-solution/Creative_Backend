import { NotFoundException } from '@nestjs/common';
import { VisitorsService } from './visitors.service';

describe('VisitorsService staff edits', () => {
  const createService = () => {
    const prisma = {
      staffAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          eventId: 'event-1',
          event: { id: 'event-1', titleAr: 'Event', titleEn: 'Event' },
        }),
      },
      registration: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'registration-1',
          eventId: 'event-1',
          fullName: 'Old Name',
          phone: '+963944111111',
          email: 'old@example.com',
          companyName: null,
          jobTitle: null,
          customFields: {},
          notes: null,
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const registrationsService = {
      update: jest.fn().mockResolvedValue({
        id: 'registration-1',
        publicId: 'REG_1',
        status: 'ACTIVE',
        fullName: 'New Name',
        phone: '+963944111111',
        email: null,
        companyName: null,
        jobTitle: null,
        customFields: {},
        attendeeType: { id: 'attendee-type-1', code: 'GENERAL' },
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      }),
    };

    return {
      prisma,
      registrationsService,
      service: new VisitorsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        registrationsService as never,
      ),
    };
  };

  it('lets STAFF update a visitor in the assigned event', async () => {
    const { prisma, registrationsService, service } = createService();

    const result = await service.updateForStaff('staff-1', 'registration-1', {
      fullName: 'New Name',
      email: null,
    });

    expect(result).toMatchObject({
      id: 'registration-1',
      fullName: 'New Name',
      email: null,
    });
    expect(registrationsService.update).toHaveBeenCalledWith('registration-1', {
      fullName: 'New Name',
      email: null,
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('does not let STAFF update a visitor in another event', async () => {
    const { registrationsService, service, prisma } = createService();
    prisma.registration.findUnique.mockResolvedValueOnce({
      id: 'registration-2',
      eventId: 'event-2',
    });

    await expect(
      service.updateForStaff('staff-1', 'registration-2', {
        fullName: 'New Name',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(registrationsService.update).not.toHaveBeenCalled();
  });
});
