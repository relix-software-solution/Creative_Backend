import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DigitalTicketTemplatesService } from './digital-ticket-templates.service';

const availableFields = [
  {
    key: 'fullName',
    labelAr: 'Full Name',
    labelEn: 'Full Name',
    source: 'FIXED',
    type: 'TEXT',
    required: true,
  },
  {
    key: 'qrCode',
    labelAr: 'QR',
    labelEn: 'QR',
    source: 'SYSTEM',
    type: 'QR',
    required: false,
  },
  {
    key: 'company',
    labelAr: 'Company',
    labelEn: 'Company',
    source: 'CUSTOM',
    type: 'TEXT',
    required: false,
  },
];

function createService() {
  const prisma = {
    event: {
      findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
    },
    attendeeType: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'attendee-1',
        eventId: 'event-1',
      }),
    },
    digitalTicketTemplate: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'ticket-template-1', ...data }),
      ),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'ticket-template-1', ...data }),
      ),
      delete: jest.fn().mockResolvedValue({ id: 'ticket-template-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockImplementation((operations) =>
      Promise.all(operations),
    ),
  };
  const badgeTemplatesService = {
    getAvailableFieldDefinitions: jest.fn().mockResolvedValue(availableFields),
  };

  return {
    prisma,
    badgeTemplatesService,
    service: new DigitalTicketTemplatesService(
      badgeTemplatesService as never,
      prisma as never,
    ),
  };
}

describe('DigitalTicketTemplatesService', () => {
  it('creates an event-wide template', async () => {
    const { prisma, service } = createService();

    await expect(
      service.create({
        eventId: 'event-1',
        name: 'Main Ticket',
        widthPx: 1080,
        heightPx: 1920,
        theme: { primary: '#A88042' },
        elements: [],
        selectedFields: [{ key: 'fullName', source: 'FIXED' }],
      }),
    ).resolves.toMatchObject({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: null,
      attendeeTypeScopeKey: '__EVENT__',
      name: 'Main Ticket',
    });
    expect(prisma.digitalTicketTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: 'event-1',
          attendeeTypeScopeKey: '__EVENT__',
        }),
      }),
    );
  });

  it('updates an attendee-type template', async () => {
    const { prisma, service } = createService();
    prisma.digitalTicketTemplate.findUnique.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
      attendeeTypeScopeKey: 'attendee-1',
      backgroundImageUrl: null,
      backgroundImagePath: null,
    });

    await expect(
      service.update('event-1', 'attendee-1', {
        name: 'VIP Ticket',
        widthPx: 1200,
        selectedFields: [{ key: 'qrCode', source: 'SYSTEM' }],
      }),
    ).resolves.toMatchObject({
      id: 'ticket-template-1',
      name: 'VIP Ticket',
      widthPx: 1200,
    });
    expect(prisma.digitalTicketTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_attendeeTypeScopeKey: {
            eventId: 'event-1',
            attendeeTypeScopeKey: 'attendee-1',
          },
        },
        data: expect.objectContaining({
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('deletes a template by event and attendee type scope', async () => {
    const { prisma, service } = createService();
    prisma.digitalTicketTemplate.findUnique.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
      attendeeTypeScopeKey: 'attendee-1',
      backgroundImageUrl: null,
      backgroundImagePath: null,
    });

    await expect(service.remove('event-1', 'attendee-1')).resolves.toEqual({
      deleted: true,
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
    });
    expect(prisma.digitalTicketTemplate.delete).toHaveBeenCalledWith({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId: 'event-1',
          attendeeTypeScopeKey: 'attendee-1',
        },
      },
    });
  });

  it('removes an event-wide background image and increments version', async () => {
    const { prisma, service } = createService();
    prisma.digitalTicketTemplate.findUnique.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: null,
      attendeeTypeScopeKey: '__EVENT__',
      backgroundImageUrl: '/uploads/digital-tickets/templates/bg.png',
      backgroundImagePath: '/uploads/digital-tickets/templates/bg.png',
      version: 1,
    });
    prisma.digitalTicketTemplate.update.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: null,
      attendeeTypeScopeKey: '__EVENT__',
      backgroundImageUrl: null,
      backgroundImagePath: null,
      version: 2,
    });

    await expect(
      service.removeBackgroundImage('event-1', null),
    ).resolves.toMatchObject({
      eventId: 'event-1',
      attendeeTypeId: null,
      backgroundImageUrl: null,
      backgroundImagePath: null,
      version: 2,
      removed: true,
      alreadyMissing: false,
    });
    expect(prisma.digitalTicketTemplate.update).toHaveBeenCalledWith({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId: 'event-1',
          attendeeTypeScopeKey: '__EVENT__',
        },
      },
      data: {
        backgroundImageUrl: null,
        backgroundImagePath: null,
        version: { increment: 1 },
      },
    });
  });

  it('removes an attendee-type background image', async () => {
    const { prisma, service } = createService();
    prisma.digitalTicketTemplate.findUnique.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
      attendeeTypeScopeKey: 'attendee-1',
      backgroundImageUrl: '/uploads/digital-tickets/templates/vip.png',
      backgroundImagePath: '/uploads/digital-tickets/templates/vip.png',
      version: 4,
    });
    prisma.digitalTicketTemplate.update.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: 'attendee-1',
      attendeeTypeScopeKey: 'attendee-1',
      backgroundImageUrl: null,
      backgroundImagePath: null,
      version: 5,
    });

    await expect(
      service.removeBackgroundImage('event-1', 'attendee-1'),
    ).resolves.toMatchObject({
      attendeeTypeId: 'attendee-1',
      version: 5,
      removed: true,
    });
  });

  it('does not increment version when background image is already missing', async () => {
    const { prisma, service } = createService();
    prisma.digitalTicketTemplate.findUnique.mockResolvedValueOnce({
      id: 'ticket-template-1',
      eventId: 'event-1',
      attendeeTypeId: null,
      attendeeTypeScopeKey: '__EVENT__',
      backgroundImageUrl: null,
      backgroundImagePath: null,
      version: 1,
    });

    await expect(
      service.removeBackgroundImage('event-1', null),
    ).resolves.toMatchObject({
      version: 1,
      removed: false,
      alreadyMissing: true,
    });
    expect(prisma.digitalTicketTemplate.update).not.toHaveBeenCalled();
  });

  it('rejects an attendee type from another event', async () => {
    const { prisma, service } = createService();
    prisma.attendeeType.findUnique.mockResolvedValueOnce({
      id: 'attendee-2',
      eventId: 'event-2',
    });

    await expect(
      service.create({
        eventId: 'event-1',
        attendeeTypeId: 'attendee-2',
        name: 'Wrong Event Ticket',
        widthPx: 1080,
        heightPx: 1920,
        theme: {},
        elements: [],
        selectedFields: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing event', async () => {
    const { prisma, service } = createService();
    prisma.event.findUnique.mockResolvedValueOnce(null);

    await expect(service.findByEvent('missing-event')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects unknown selected fields', async () => {
    const { service } = createService();

    await expect(
      service.create({
        eventId: 'event-1',
        name: 'Invalid Fields',
        widthPx: 1080,
        heightPx: 1920,
        theme: {},
        elements: [],
        selectedFields: [{ key: 'notAField', source: 'CUSTOM' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns reusable available fields plus ticket system fields', async () => {
    const { service } = createService();

    await expect(service.availableFields('event-1')).resolves.toEqual({
      fields: expect.arrayContaining([
        expect.objectContaining({ key: 'fullName' }),
        expect.objectContaining({ key: 'company' }),
        expect.objectContaining({ key: 'qrCode' }),
        expect.objectContaining({ key: 'eventName' }),
        expect.objectContaining({ key: 'eventDate' }),
        expect.objectContaining({ key: 'venueName' }),
      ]),
    });
  });
});
