import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import QRCode from 'qrcode';

type GenerateRegistrationQrImageInput = {
  registrationPublicId: string;
  qrToken: string;
  requestBaseUrl?: string;
};

type GetRegistrationQrImageMetadataInput = {
  registrationPublicId: string;
  qrToken: string;
  requestBaseUrl?: string;
};

@Injectable()
export class QrImageService {
  constructor(private readonly configService: ConfigService) {}

  async generateRegistrationQrImage(input: GenerateRegistrationQrImageInput) {
    const filename = this.buildQrFilename(
      input.registrationPublicId,
      input.qrToken,
    );

    const outputDir = join(this.uploadRoot, 'qr');
    const filePath = join(outputDir, filename);

    await mkdir(outputDir, {
      recursive: true,
    });

    await QRCode.toFile(filePath, input.qrToken.trim(), {
      type: 'png',

      /*
       * L تعطي أقل Error Correction،
       * وقد تساعد بالحصول على QR أخف عندما يكون طول
       * المحتوى قريبًا من حدود إصدارات QR.
       */
      errorCorrectionLevel: 'L',

      /*
       * Quiet Zone قياسية.
       */
      margin: 4,

      /*
       * دقة الصورة وليست كثافة المعلومات.
       */
      width: 1024,

      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    const relativePath = `/uploads/qr/${filename}`;

    return {
      filePath,

      relativePath,

      publicUrl: `${this.resolveBaseUrl(input.requestBaseUrl)}${relativePath}`,
    };
  }

  async getRegistrationQrImageMetadata(
    input: GetRegistrationQrImageMetadataInput,
  ) {
    const qrToken = input.qrToken.trim();

    const filename = this.buildQrFilename(input.registrationPublicId, qrToken);

    const filePath = join(this.uploadRoot, 'qr', filename);

    try {
      await access(filePath);
    } catch {
      return null;
    }

    const relativePath = `/uploads/qr/${filename}`;

    return {
      filePath,

      relativePath,

      publicUrl: `${this.resolveBaseUrl(input.requestBaseUrl)}${relativePath}`,
    };
  }

  private buildQrFilename(registrationPublicId: string, qrToken: string) {
    const publicId = this.sanitizeFilename(registrationPublicId);

    /*
     * عند تغير التوكن يتغير اسم الصورة.
     *
     * هذا يمنع إعادة استخدام PNG قديمة مولدة
     * من Full Signed QR الكثيف.
     */
    const tokenFingerprint = createHash('sha256')
      .update(qrToken.trim(), 'utf8')
      .digest('hex')
      .slice(0, 16);

    return `${publicId}-${tokenFingerprint}.png`;
  }

  private sanitizeFilename(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private resolveBaseUrl(requestBaseUrl?: string) {
    return (
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ||
      requestBaseUrl ||
      `http://localhost:${this.configService.get<number>('PORT', 3000)}`
    ).replace(/\/+$/, '');
  }

  private get uploadRoot() {
    return (
      this.configService.get<string>('STORAGE_UPLOAD_ROOT') ??
      join(process.cwd(), 'uploads')
    );
  }
}
