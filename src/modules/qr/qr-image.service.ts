import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import QRCode from 'qrcode';

type GenerateRegistrationQrImageInput = {
  registrationPublicId: string;
  qrToken: string;
  requestBaseUrl?: string;
};

@Injectable()
export class QrImageService {
  constructor(private readonly configService: ConfigService) {}

  async generateRegistrationQrImage(input: GenerateRegistrationQrImageInput) {
    const filename = `${this.sanitizeFilename(
      input.registrationPublicId,
    )}.png`;
    const outputDir = join(this.uploadRoot, 'qr');
    const filePath = join(outputDir, filename);

    await mkdir(outputDir, { recursive: true });

    /*
     * M is intentionally used instead of H.
     *
     * The Digital Ticket uses the short compact signed token, so M provides
     * a better balance:
     * - fewer QR modules
     * - larger visual pixels/modules
     * - faster scanning at exhibition gates
     * - sufficient correction for clean phone screens and printed tickets
     */
    await QRCode.toFile(filePath, input.qrToken, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 1024,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    return {
      filePath,
      relativePath: `/uploads/qr/${filename}`,
      publicUrl: `${this.resolveBaseUrl(
        input.requestBaseUrl,
      )}/uploads/qr/${filename}`,
    };
  }

  async getRegistrationQrImageMetadata(input: {
    registrationPublicId: string;
    requestBaseUrl?: string;
  }) {
    const filename = `${this.sanitizeFilename(
      input.registrationPublicId,
    )}.png`;
    const filePath = join(this.uploadRoot, 'qr', filename);

    try {
      await access(filePath);
    } catch {
      return null;
    }

    return {
      filePath,
      relativePath: `/uploads/qr/${filename}`,
      publicUrl: `${this.resolveBaseUrl(
        input.requestBaseUrl,
      )}/uploads/qr/${filename}`,
    };
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