import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, OfflineKeyStatus, Prisma } from '@prisma/client';
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export type OfflineQrPayload = {
  /*
   * V1: الصيغة القديمة على شكل Object.
   * V2: الصيغة المختصرة الجديدة على شكل Array.
   */
  v: 1 | 2;

  type: 'OFFLINE_REGISTRATION';

  eventId: string;
  issuerDeviceId: string;
  issuerKeyVersion: number;

  offlineRegistrationOperationId: string;

  /*
   * موجود في V1 القديمة فقط.
   */
  offlineRegistrationId?: string;

  offlineQrToken: string;
  attendeeTypeId: string;

  /*
   * موجود في V1 القديمة فقط.
   */
  displayName?: string;

  /*
   * بعد قراءة V2 نحوّل Unix seconds إلى ISO،
   * حتى يبقى باقي الباك يعمل دون تغيير.
   */
  issuedAt: string;
  validUntil: string;
};

type CompactOfflineQrPayloadV2 = readonly [
  version: 2,
  eventId: string,
  issuerDeviceId: string,
  issuerKeyVersion: number,
  offlineRegistrationOperationId: string,
  offlineQrToken: string,
  attendeeTypeId: string,
  issuedAtSeconds: number,
  validUntilSeconds: number,
];

export type VerifiedOfflineQr = {
  signedOfflineQr: string;
  encodedPayload: string;
  signature: string;
  payload: OfflineQrPayload;
  payloadHash: string;
};

@Injectable()
export class OfflineQrService {
  constructor(private readonly prisma: PrismaService) {}

  async provisionDevicePublicKey(input: {
    deviceId: string;
    publicKey: string;
    keyVersion: number;
    rotateExisting?: boolean;
  }) {
    this.assertEd25519PublicKey(input.publicKey);

    const device = await this.prisma.device.findUnique({
      where: { id: input.deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.rotateExisting) {
        await tx.deviceOfflineKey.updateMany({
          where: {
            deviceId: input.deviceId,
            status: OfflineKeyStatus.ACTIVE,
            version: { not: input.keyVersion },
          },
          data: { status: OfflineKeyStatus.ROTATED, validUntil: new Date() },
        });
      }

      const key = await tx.deviceOfflineKey.upsert({
        where: {
          deviceId_version: {
            deviceId: input.deviceId,
            version: input.keyVersion,
          },
        },
        create: {
          deviceId: input.deviceId,
          version: input.keyVersion,
          publicKey: input.publicKey,
          status: OfflineKeyStatus.ACTIVE,
          validFrom: new Date(),
        },
        update: {
          publicKey: input.publicKey,
          status: OfflineKeyStatus.ACTIVE,
          validUntil: null,
          revokedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          eventId: device.eventId,
          action: 'UPDATE',
          entityType: 'DeviceOfflineKey',
          entityId: key.id,
          metadata: {
            deviceId: input.deviceId,
            keyVersion: input.keyVersion,
            rotated: input.rotateExisting === true,
          },
        },
      });

      return key;
    });
  }

  async getTrustBundle(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Device must be ACTIVE');
    }

    const keys = await this.prisma.deviceOfflineKey.findMany({
      where: {
        device: {
          eventId: device.eventId,
          status: DeviceStatus.ACTIVE,
        },
        status: { in: [OfflineKeyStatus.ACTIVE, OfflineKeyStatus.ROTATED] },
      },
      include: {
        device: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: [{ deviceId: 'asc' }, { version: 'desc' }],
    });

    return {
      eventId: device.eventId,
      generatedAt: new Date().toISOString(),
      devices: keys.map((key) => ({
        deviceId: key.deviceId,
        code: key.device.code,
        name: key.device.name,
        keyVersion: key.version,
        publicKey: key.publicKey,
        status: key.status,
        validFrom: key.validFrom,
        validUntil: key.validUntil,
      })),
    };
  }

  async verifySignedOfflineQr(
    signedOfflineQr: string,
    expectedEventId?: string,
  ): Promise<VerifiedOfflineQr> {
    const parsed = this.parseSignedOfflineQr(signedOfflineQr);
    this.assertOfflineQrPayload(parsed.payload);

    if (expectedEventId && parsed.payload.eventId !== expectedEventId) {
      throw new BadRequestException('Offline QR event mismatch');
    }

    const validUntil = new Date(parsed.payload.validUntil);
    if (Number.isNaN(validUntil.getTime()) || validUntil < new Date()) {
      throw new BadRequestException('Offline QR expired');
    }

    const issuer = await this.prisma.device.findUnique({
      where: { id: parsed.payload.issuerDeviceId },
      include: {
        offlineKeys: {
          where: { version: parsed.payload.issuerKeyVersion },
          take: 1,
        },
      },
    });

    if (!issuer || issuer.eventId !== parsed.payload.eventId) {
      throw new BadRequestException('Offline QR issuer is not trusted');
    }

    const key = issuer.offlineKeys[0];
    if (!key) {
      throw new BadRequestException('Offline QR issuer key not found');
    }

    this.assertKeyUsableForPayload(key, parsed.payload);
    this.assertEd25519PublicKey(key.publicKey);

    const publicKey = createPublicKey(key.publicKey);
    const signature = Buffer.from(parsed.signature, 'base64url');
    const verified = verifySignature(
      null,
      Buffer.from(parsed.encodedPayload),
      publicKey,
      signature,
    );

    if (!verified) {
      throw new BadRequestException('Invalid offline QR signature');
    }

    return parsed;
  }

  parseSignedOfflineQr(signedOfflineQr: string): VerifiedOfflineQr {
    const [encodedPayload, signature, extra] = signedOfflineQr.split('.');

    if (!encodedPayload || !signature || extra !== undefined) {
      throw new BadRequestException('Invalid offline QR token format');
    }

    let rawPayload: unknown;

    try {
      rawPayload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as unknown;
    } catch {
      throw new BadRequestException('Invalid offline QR payload encoding');
    }

    /*
     * نحول V1 القديمة وV2 الجديدة إلى نفس الشكل الداخلي.
     * بذلك بقية ScansService والمزامنة لا تحتاج إلى تعديل.
     */
    const payload = this.normalizeOfflineQrPayload(rawPayload);

    return {
      signedOfflineQr,
      encodedPayload,
      signature,
      payload,

      /*
       * نحسب Hash من الشكل الموحّد.
       */
      payloadHash: this.hashPayload(payload),
    };
  }

  hashPayload(payload: unknown) {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  tokensEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private normalizeOfflineQrPayload(value: unknown): OfflineQrPayload {
    /*
     * الصيغة الجديدة المختصرة V2.
     */
    if (Array.isArray(value)) {
      if (value.length !== 9) {
        throw new BadRequestException(
          'Invalid compact offline QR payload length',
        );
      }

      const [
        version,
        eventId,
        issuerDeviceId,
        issuerKeyVersion,
        offlineRegistrationOperationId,
        offlineQrToken,
        attendeeTypeId,
        issuedAtSeconds,
        validUntilSeconds,
      ] = value as unknown as CompactOfflineQrPayloadV2;

      if (version !== 2) {
        throw new BadRequestException(
          'Unsupported compact offline QR payload version',
        );
      }

      const requiredStrings = [
        eventId,
        issuerDeviceId,
        offlineRegistrationOperationId,
        offlineQrToken,
        attendeeTypeId,
      ];

      if (
        requiredStrings.some(
          (item) => typeof item !== 'string' || item.trim().length === 0,
        )
      ) {
        throw new BadRequestException(
          'Compact offline QR contains invalid identifiers',
        );
      }

      if (!Number.isInteger(issuerKeyVersion) || issuerKeyVersion < 1) {
        throw new BadRequestException(
          'Compact offline QR key version is invalid',
        );
      }

      if (
        !Number.isInteger(issuedAtSeconds) ||
        !Number.isInteger(validUntilSeconds) ||
        issuedAtSeconds <= 0 ||
        validUntilSeconds <= issuedAtSeconds
      ) {
        throw new BadRequestException(
          'Compact offline QR timestamps are invalid',
        );
      }

      const issuedAt = new Date(issuedAtSeconds * 1000);
      const validUntil = new Date(validUntilSeconds * 1000);

      if (
        Number.isNaN(issuedAt.getTime()) ||
        Number.isNaN(validUntil.getTime())
      ) {
        throw new BadRequestException('Compact offline QR dates are invalid');
      }

      return {
        v: 2,
        type: 'OFFLINE_REGISTRATION',

        eventId,
        issuerDeviceId,
        issuerKeyVersion,

        offlineRegistrationOperationId,

        offlineQrToken,
        attendeeTypeId,

        issuedAt: issuedAt.toISOString(),
        validUntil: validUntil.toISOString(),
      };
    }

    /*
     * الصيغة القديمة V1.
     * لا نحذف دعمها لأن هناك Badges مطبوعة سابقًا.
     */
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Invalid offline QR payload structure');
    }

    return value as OfflineQrPayload;
  }

  private assertOfflineQrPayload(payload: OfflineQrPayload) {
    const requiredStrings: Array<keyof OfflineQrPayload> = [
      'type',
      'eventId',
      'issuerDeviceId',
      'offlineRegistrationOperationId',
      'offlineQrToken',
      'attendeeTypeId',
      'issuedAt',
      'validUntil',
    ];

    if (
      (payload.v !== 1 && payload.v !== 2) ||
      payload.type !== 'OFFLINE_REGISTRATION'
    ) {
      throw new BadRequestException('Unsupported offline QR payload version');
    }

    if (!Number.isInteger(payload.issuerKeyVersion)) {
      throw new BadRequestException('Offline QR key version is required');
    }

    for (const field of requiredStrings) {
      if (typeof payload[field] !== 'string' || payload[field].trim() === '') {
        throw new BadRequestException(`Offline QR ${field} is required`);
      }
    }

    const issuedAt = new Date(payload.issuedAt);
    if (Number.isNaN(issuedAt.getTime())) {
      throw new BadRequestException('Offline QR issuedAt is invalid');
    }
  }

  private assertKeyUsableForPayload(
    key: {
      status: OfflineKeyStatus;
      validFrom: Date;
      validUntil: Date | null;
      revokedAt: Date | null;
    },
    payload: OfflineQrPayload,
  ) {
    const issuedAt = new Date(payload.issuedAt);

    if (issuedAt < key.validFrom) {
      throw new BadRequestException('Offline QR predates issuer key validity');
    }

    if (key.validUntil && issuedAt > key.validUntil) {
      throw new BadRequestException('Offline QR was issued after key rotation');
    }

    if (
      key.status === OfflineKeyStatus.REVOKED &&
      (!key.revokedAt || issuedAt >= key.revokedAt)
    ) {
      throw new BadRequestException('Offline QR issuer key is revoked');
    }
  }

  private assertEd25519PublicKey(publicKey: string) {
    try {
      const key = createPublicKey(publicKey);
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error('Public key must be Ed25519');
      }
    } catch {
      throw new BadRequestException('Invalid Ed25519 public key');
    }
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
