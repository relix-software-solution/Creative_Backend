import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventStatus,
  Prisma,
  QrToken,
  QrTokenStatus,
  RegistrationStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  CompactQrPayload,
  createCompactQrToken,
  createSignedQrToken,
  QrPayload,
  verifyCompactQrToken,
  verifySignedQrToken,
} from '../../common/utils/qr-signing.util';
import { PrismaService } from '../../database/prisma.service';

type QrTokenWithPayload = QrToken & { payload: QrPayload };

@Injectable()
export class QrService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(registrationId: string) {
    const registration =
      await this.findRegistrationWithRelations(registrationId);

    if (registration.event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }

    /**
     * العلاقة one-to-one:
     *
     * registrationId داخل QrToken فريد.
     *
     * لذلك نستخدم findUnique، وليس البحث فقط
     * عن QR فعال.
     */
    const existingQrToken = await this.prisma.qrToken.findUnique({
      where: {
        registrationId,
      },
    });

    if (existingQrToken?.status === QrTokenStatus.ACTIVE) {
      return this.formatQrToken(existingQrToken as QrTokenWithPayload);
    }

    const validFrom =
      registration.event.qrValidFrom ?? registration.event.startsAt;

    const validUntil =
      registration.event.qrValidUntil ?? registration.event.endsAt;

    const payload: QrPayload = {
      tokenId: await this.generateTokenId(),
      eventId: registration.eventId,
      registrationId: registration.id,
      registrationPublicId: registration.publicId,
      attendeeTypeId: registration.attendeeTypeId,
      attendeeTypeCode: registration.attendeeType.code,
      issuedAt: new Date().toISOString(),
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      nonce: randomBytes(12).toString('base64url'),
    };

    const qrToken = createSignedQrToken(payload, this.signingSecret);

    const signature = qrToken.split('.')[1];

    const storedQrToken = await this.createOrRefreshQrToken({
      registrationId: registration.id,
      eventId: registration.eventId,
      tokenId: payload.tokenId,
      payload,
      signature,
      validFrom,
      validUntil,
      existingQrToken,
    });

    return this.formatQrToken(storedQrToken as QrTokenWithPayload);
  }

  async findByRegistration(registrationId: string) {
    await this.findRegistrationWithRelations(registrationId);

    const qrToken = await this.prisma.qrToken.findUnique({
      where: { registrationId },
    });

    if (!qrToken) {
      throw new NotFoundException('QR token not found');
    }

    return this.formatQrToken(qrToken as QrTokenWithPayload);
  }

  async validate(qrToken: string) {
    let payload: QrPayload | CompactQrPayload;

    try {
      payload = verifySignedQrToken(qrToken, this.signingSecret);
    } catch {
      try {
        payload = verifyCompactQrToken(qrToken, this.signingSecret);
      } catch {
        return { valid: false, reason: 'INVALID_SIGNATURE' };
      }
    }

    const storedQrToken = await this.prisma.qrToken.findUnique({
      where: { tokenId: payload.tokenId },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true, status: true },
        },
        registration: {
          include: {
            attendeeType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
          },
        },
      },
    });

    if (!storedQrToken) {
      return { valid: false, reason: 'TOKEN_NOT_FOUND', payload };
    }

    if (
      this.isFullPayload(payload) &&
      (storedQrToken.eventId !== payload.eventId ||
        storedQrToken.registrationId !== payload.registrationId ||
        storedQrToken.registration.publicId !== payload.registrationPublicId)
    ) {
      return { valid: false, reason: 'EVENT_MISMATCH', payload };
    }

    if (storedQrToken.status === QrTokenStatus.REVOKED) {
      return { valid: false, reason: 'TOKEN_REVOKED', payload };
    }

    const now = new Date();
    if (
      storedQrToken.status === QrTokenStatus.EXPIRED ||
      now < storedQrToken.validFrom ||
      now > storedQrToken.validUntil
    ) {
      return { valid: false, reason: 'TOKEN_EXPIRED', payload };
    }

    if (storedQrToken.registration.status !== RegistrationStatus.ACTIVE) {
      return { valid: false, reason: 'REGISTRATION_INACTIVE', payload };
    }

    return {
      valid: true,
      reason: 'VALID',
      registration: {
        id: storedQrToken.registration.id,
        publicId: storedQrToken.registration.publicId,
        fullName: storedQrToken.registration.fullName,
        phone: storedQrToken.registration.phone,
        email: storedQrToken.registration.email,
        status: storedQrToken.registration.status,
      },
      event: storedQrToken.event,
      attendeeType: storedQrToken.registration.attendeeType,
      payload,
    };
  }

  async revoke(registrationId: string) {
    const registration =
      await this.findRegistrationWithRelations(registrationId);

    if (registration.event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }

    const qrToken = await this.prisma.qrToken.findUnique({
      where: { registrationId },
    });

    if (!qrToken) {
      throw new NotFoundException('QR token not found');
    }

    const revokedQrToken = await this.prisma.qrToken.update({
      where: { registrationId },
      data: {
        status: QrTokenStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    return this.formatQrToken(revokedQrToken as QrTokenWithPayload);
  }

  private async findRegistrationWithRelations(registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: true,
        attendeeType: true,
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  private formatQrToken(qrToken: QrTokenWithPayload) {
    return {
      qrToken: createSignedQrToken(qrToken.payload, this.signingSecret),
      compactQrToken: createCompactQrToken(qrToken.tokenId, this.signingSecret),
      payload: qrToken.payload,
      validFrom: qrToken.validFrom,
      validUntil: qrToken.validUntil,
      status: qrToken.status,
      revokedAt: qrToken.revokedAt,
      generatedAt: qrToken.generatedAt,
    };
  }

  private async createOrRefreshQrToken(input: {
    registrationId: string;
    eventId: string;
    tokenId: string;
    payload: QrPayload;
    signature: string;
    validFrom: Date;
    validUntil: Date;
    existingQrToken: QrToken | null;
  }) {
    const now = new Date();

    /**
     * يوجد QR قديم REVOKED أو EXPIRED:
     * ندوّر السجل نفسه بدل محاولة إنشاء سجل جديد.
     */
    if (input.existingQrToken) {
      const updateResult = await this.prisma.qrToken.updateMany({
        where: {
          id: input.existingQrToken.id,

          /**
           * هذه الشروط تمنع طلبين متزامنين
           * من استبدال QR الواحد مرتين.
           */
          tokenId: input.existingQrToken.tokenId,
          status: input.existingQrToken.status,
        },
        data: {
          eventId: input.eventId,
          tokenId: input.tokenId,

          payload: input.payload as unknown as Prisma.InputJsonValue,

          signature: input.signature,
          validFrom: input.validFrom,
          validUntil: input.validUntil,

          status: QrTokenStatus.ACTIVE,
          revokedAt: null,
          generatedAt: now,
        },
      });

      if (updateResult.count === 1) {
        const refreshedQrToken = await this.prisma.qrToken.findUnique({
          where: {
            registrationId: input.registrationId,
          },
        });

        if (!refreshedQrToken) {
          throw new NotFoundException('QR token was not found after refresh');
        }

        return refreshedQrToken;
      }

      /**
       * طلب آخر ربما فعّل QR في نفس اللحظة.
       * نعيد استخدام الرمز الذي فاز بالسباق.
       */
      const activeQrToken = await this.prisma.qrToken.findFirst({
        where: {
          registrationId: input.registrationId,
          status: QrTokenStatus.ACTIVE,
        },
      });

      if (activeQrToken) {
        return activeQrToken;
      }

      throw new BadRequestException('Could not refresh QR token');
    }

    /**
     * تسجيل جديد لا يملك QR سابقًا.
     */
    try {
      return await this.prisma.qrToken.create({
        data: {
          registrationId: input.registrationId,
          eventId: input.eventId,
          tokenId: input.tokenId,

          payload: input.payload as unknown as Prisma.InputJsonValue,

          signature: input.signature,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          status: QrTokenStatus.ACTIVE,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      /**
       * قد يكون Queue وPublicService طلبا توليد QR
       * في الوقت نفسه.
       */
      const activeQrToken = await this.prisma.qrToken.findFirst({
        where: {
          registrationId: input.registrationId,
          status: QrTokenStatus.ACTIVE,
        },
      });

      if (activeQrToken) {
        return activeQrToken;
      }

      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isFullPayload(
    payload: QrPayload | CompactQrPayload,
  ): payload is QrPayload {
    return 'eventId' in payload && 'registrationId' in payload;
  }

  private async generateTokenId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const tokenId = `QRT_${randomBytes(8).toString('hex').toUpperCase()}`;
      const existingQrToken = await this.prisma.qrToken.findUnique({
        where: { tokenId },
      });

      if (!existingQrToken) {
        return tokenId;
      }
    }

    throw new BadRequestException('Could not generate unique QR token ID');
  }

  private get signingSecret(): string {
    return this.configService.getOrThrow<string>('QR_SIGNING_SECRET');
  }
}
