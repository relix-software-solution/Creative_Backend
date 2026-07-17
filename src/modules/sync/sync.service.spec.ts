import { SyncService } from './sync.service';

describe('SyncService offline registration compatibility', () => {
  it('keeps ALREADY_SYNCED offline registration idempotent', async () => {
    const prisma = {
      offlineRegistrationMapping: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mapping-1',
          registrationId: 'registration-1',
          offlineQrToken: 'offline-token',
          payloadHash: 'hash-1',
          canonicalQrTokenId: 'qr-token-row-1',
        }),
      },
      registration: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'registration-1',
          publicId: 'REG_OFFLINE',
        }),
      },
    };
    const registrationsService = { create: jest.fn() };
    const offlineQrService = {
      verifySignedOfflineQr: jest.fn().mockResolvedValue({
        payloadHash: 'hash-1',
        payload: {
          eventId: 'event-1',
          issuerDeviceId: 'device-1',
          offlineRegistrationOperationId: 'offline-op-1',
          offlineRegistrationId: 'local-reg-1',
          offlineQrToken: 'offline-token',
          attendeeTypeId: 'attendee-1',
        },
      }),
    };
    const service = new SyncService(
      prisma as never,
      registrationsService as never,
      {} as never,
      {} as never,
      offlineQrService as never,
      {} as never,
    );
    const localRegistrations = new Map();

    await expect(
      (service as any).runOfflineRegistration(
        {
          payload: {
            eventId: 'event-1',
            signedOfflineQr: 'signed-offline',
            offlineRegistrationOperationId: 'offline-op-1',
            offlineRegistrationId: 'local-reg-1',
            offlineQrToken: 'offline-token',
            attendeeTypeId: 'attendee-1',
          },
        },
        { eventId: 'event-1', deviceId: 'device-1' },
        localRegistrations,
      ),
    ).resolves.toEqual({
      status: 'ALREADY_SYNCED',
      registrationId: 'registration-1',
      publicId: 'REG_OFFLINE',
      offlineRegistrationOperationId: 'offline-op-1',
      offlineRegistrationId: 'local-reg-1',
      offlineQrToken: 'offline-token',
      canonicalQrTokenId: 'qr-token-row-1',
    });
    expect(registrationsService.create).not.toHaveBeenCalled();
    expect(localRegistrations.get('local-reg-1')).toEqual({
      id: 'registration-1',
      publicId: 'REG_OFFLINE',
    });
  });
});
