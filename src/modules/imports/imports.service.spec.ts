import { ImportsService } from './imports.service';

describe('ImportsService WhatsApp backpressure', () => {
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

    expect((service as any).whatsappNotificationsQueue.getJobCounts).toHaveBeenCalledTimes(3);
  });

  it('keeps import row output compact and asynchronous', async () => {
    const prisma = {
      registrationField: { findMany: jest.fn().mockResolvedValue([]) },
      attendeeType: {
        findFirst: jest.fn().mockResolvedValue({ id: 'attendee-1' }),
      },
      importRow: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const registrationsService = {
      create: jest.fn().mockResolvedValue({
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
            full_name: 'Import Visitor',
            phone: '+963944000000',
          },
        } as never,
        {
          eventId: 'event-1',
          generateQr: true,
          source: 'EXCEL_IMPORT',
        } as never,
      ),
    ).resolves.toBe('PROCESSED');

    expect(prisma.importRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          normalizedData: expect.objectContaining({
            output: {
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
