import { EventsService } from './events.service';

describe('EventsService cascade delete', () => {
  const deleteManyResult = { count: 1 };

  it('deletes event badge templates before deleting the event', async () => {
    const tx = {
      offlineScanOperation: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      offlineRegistrationMapping: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      notificationLog: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      movementLog: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      scanEventRaw: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      qrToken: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      syncOperation: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      syncBatch: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      importRow: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      importJob: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      digitalTicketImage: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      staffSession: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      staffAssignment: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      deviceOfflineKey: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      device: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      checkpoint: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      zone: {
        updateMany: jest.fn().mockResolvedValue(deleteManyResult),
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      venue: { deleteMany: jest.fn().mockResolvedValue(deleteManyResult) },
      registrationField: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      registration: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      digitalTicketTemplate: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      attendeeType: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      eventBranding: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      eventBadgeTemplate: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      notificationTemplate: {
        deleteMany: jest.fn().mockResolvedValue(deleteManyResult),
      },
      event: { delete: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    };
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'event-1' }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const storageCleanupService = {
      findEventOwnedFiles: jest
        .fn()
        .mockResolvedValue([
          '/uploads/badge-templates/old.png',
          '/uploads/qr/REG_001.png',
        ]),
      enqueueEventCleanup: jest.fn().mockResolvedValue({
        queued: true,
        jobId: 'cleanup-job-1',
      }),
    };
    const service = new EventsService(
      prisma as never,
      storageCleanupService as never,
    );

    const result = await service.remove('event-1');

    expect(result.summary.badgeTemplates).toBe(1);
    expect(result.summary.digitalTicketImages).toBe(1);
    expect(result.summary.digitalTicketTemplates).toBe(1);
    expect(result.storageCleanup).toEqual({
      queued: true,
      jobId: 'cleanup-job-1',
    });
    expect(storageCleanupService.findEventOwnedFiles).toHaveBeenCalledWith(
      'event-1',
    );
    expect(storageCleanupService.enqueueEventCleanup).toHaveBeenCalledWith({
      eventId: 'event-1',
      relativePaths: [
        '/uploads/badge-templates/old.png',
        '/uploads/qr/REG_001.png',
      ],
    });
    expect(tx.eventBadgeTemplate.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
    });
    expect(tx.digitalTicketImage.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
    });
    expect(tx.digitalTicketTemplate.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
    });
    expect(tx.event.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
  });

  it('does not enqueue cleanup when the database transaction fails', async () => {
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('DB failed')),
    };
    const storageCleanupService = {
      findEventOwnedFiles: jest
        .fn()
        .mockResolvedValue(['/uploads/qr/REG_001.png']),
      enqueueEventCleanup: jest.fn(),
    };
    const service = new EventsService(
      prisma as never,
      storageCleanupService as never,
    );

    await expect(service.remove('event-1')).rejects.toThrow('DB failed');
    expect(storageCleanupService.enqueueEventCleanup).not.toHaveBeenCalled();
  });
});
