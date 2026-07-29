import { EventStatus, RegistrationSource } from '@prisma/client';
import { ImportsService } from './imports.service';

describe('ImportsService', () => {
  it('waits until WhatsApp queue depth reaches the resume threshold', async () => {
    const service = new ImportsService(
      {
        get: jest.fn((key: string, fallback?: unknown) => {
          const values: Record<string, unknown> = {
            WHATSAPP_QUEUE_BACKPRESSURE_ENABLED: true,
            WHATSAPP_QUEUE_MAX_WAITING: 10,
            WHATSAPP_QUEUE_RESUME_THRESHOLD: 5,
          };

          return values[key] ?? fallback;
        }),
      } as never,
      {} as never,
      {
        getJobCounts: jest
          .fn()
          .mockResolvedValueOnce({ waiting: 10, delayed: 2 })
          .mockResolvedValueOnce({ waiting: 6, delayed: 0 })
          .mockResolvedValueOnce({ waiting: 4, delayed: 0 }),
      } as never,
      {} as never,
      {} as never,
    );

    jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

    await (service as any).waitForWhatsAppBackpressure();

    expect(
      (service as any).whatsappNotificationsQueue.getJobCounts,
    ).toHaveBeenCalledTimes(3);
  });

  it('keeps import row output compact and uses the import-specific registration path', async () => {
    const prisma = {
      registration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      importRow: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const registrationsService = {
      createFromImport: jest.fn().mockResolvedValue({
        id: 'registration-1',
        publicId: 'REG_IMPORT',
      }),
    };

    const service = new ImportsService(
      { get: jest.fn().mockReturnValue(false) } as never,
      {} as never,
      { getJobCounts: jest.fn() } as never,
      prisma as never,
      registrationsService as never,
    );

    await expect(
      service.processImportRow(
        {
          id: 'row-1',
          rawData: {
            Name: 'Import Visitor',
            Phone: '',
          },
        } as never,
        {
          event: {
            id: 'event-1',
            status: EventStatus.ACTIVE,
            duplicateStrategy: 'PHONE',
          } as never,
          eventId: 'event-1',
          attendeeTypeId: 'attendee-1',
          generateQr: true,
          source: RegistrationSource.EXCEL_IMPORT,
          duplicateStrategy: 'SKIP',
          mapping: {
            fullName: 'Name',
            phone: 'Phone',
          },
          registrationFields: [],
          attendeeTypes: [],
          attendeeTypesByCode: new Map(),
          attendeeTypeIds: new Set(['attendee-1']),
          defaultAttendeeTypeId: 'attendee-1',
        },
      ),
    ).resolves.toBe('PROCESSED');

    expect(registrationsService.createFromImport).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Import Visitor',
        phone: null,
      }),
      expect.objectContaining({
        enqueuePipeline: true,
      }),
    );

    expect(prisma.importRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          normalizedData: expect.objectContaining({
            output: {
              action: 'CREATED',
              registrationId: 'registration-1',
              publicId: 'REG_IMPORT',
            },
          }),
        }),
      }),
    );

    expect(JSON.stringify(prisma.importRow.update.mock.calls)).not.toContain(
      'digitalTicket',
    );
  });
});
