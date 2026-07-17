import { BadRequestException } from '@nestjs/common';
import { OfflineKeyStatus } from '@prisma/client';
import { generateKeyPairSync, sign } from 'crypto';
import { OfflineQrService } from './offline-qr.service';

describe('OfflineQrService', () => {
  const eventId = 'event_1';
  const issuerDeviceId = 'device_issuer';
  const keyVersion = 1;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const prisma = {
    device: {
      findUnique: jest.fn(),
    },
  };
  let service: OfflineQrService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OfflineQrService(prisma as never);
    prisma.device.findUnique.mockResolvedValue({
      id: issuerDeviceId,
      eventId,
      status: 'ACTIVE',
      offlineKeys: [
        {
          publicKey: publicKeyPem,
          version: keyVersion,
          status: OfflineKeyStatus.ACTIVE,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: null,
          revokedAt: null,
        },
      ],
    });
  });

  it('verifies a valid device-signed offline QR', async () => {
    const token = signPayload({
      issuedAt: '2026-07-14T08:00:00.000Z',
      validUntil: '2099-07-14T08:00:00.000Z',
    });

    await expect(service.verifySignedOfflineQr(token, eventId)).resolves.toMatchObject({
      payload: {
        eventId,
        issuerDeviceId,
        offlineQrToken: 'evt_offline_1',
      },
    });
  });

  it('rejects an invalid signature', async () => {
    const token = signPayload({
      issuedAt: '2026-07-14T08:00:00.000Z',
      validUntil: '2099-07-14T08:00:00.000Z',
    });
    const [payload] = token.split('.');

    await expect(
      service.verifySignedOfflineQr(`${payload}.tampered`, eventId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects the wrong event', async () => {
    const token = signPayload({
      eventId: 'event_other',
      issuedAt: '2026-07-14T08:00:00.000Z',
      validUntil: '2099-07-14T08:00:00.000Z',
    });

    await expect(
      service.verifySignedOfflineQr(token, eventId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired offline QR', async () => {
    const token = signPayload({
      issuedAt: '2000-01-01T00:00:00.000Z',
      validUntil: '2000-01-01T00:01:00.000Z',
    });

    await expect(
      service.verifySignedOfflineQr(token, eventId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  function signPayload(overrides: Record<string, unknown>) {
    const payload = {
      v: 1,
      type: 'OFFLINE_REGISTRATION',
      eventId,
      issuerDeviceId,
      issuerKeyVersion: keyVersion,
      offlineRegistrationOperationId: 'OFFREG-device-0001',
      offlineRegistrationId: 'OFFREGLOCAL-device-0001',
      offlineQrToken: 'evt_offline_1',
      attendeeTypeId: 'attendee_type_1',
      displayName: 'Offline Visitor',
      issuedAt: '2026-07-14T08:00:00.000Z',
      validUntil: '2099-07-14T08:00:00.000Z',
      ...overrides,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = sign(
      null,
      Buffer.from(encodedPayload),
      privateKey,
    ).toString('base64url');

    return `${encodedPayload}.${signature}`;
  }
});
