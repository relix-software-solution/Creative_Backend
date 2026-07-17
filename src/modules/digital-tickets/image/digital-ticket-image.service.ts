import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join, normalize, resolve, sep } from 'path';
import { safeDeleteUploadFile } from '../../../common/utils/upload-file.util';
import { PrismaService } from '../../../database/prisma.service';

const GENERATED_TICKET_DIR = 'digital-tickets/generated';
const PREVIEW_TICKET_DIR = 'digital-tickets/previews';

@Injectable()
export class DigitalTicketImageService {
  private readonly logger = new Logger(DigitalTicketImageService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async saveGeneratedImage(input: {
    eventId: string;
    registrationId: string;
    templateId: string;
    templateVersion: number;
    png: Buffer;
    requestBaseUrl?: string;
  }) {
    const file = await this.writeImage(
      GENERATED_TICKET_DIR,
      input.png,
      input.requestBaseUrl,
    );
    const generatedAt = new Date();

    return this.prisma.digitalTicketImage.upsert({
      where: {
        registrationId_templateId_templateVersion: {
          registrationId: input.registrationId,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
        },
      },
      create: {
        eventId: input.eventId,
        registrationId: input.registrationId,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        imageUrl: file.imageUrl,
        relativePath: file.relativePath,
        generatedAt,
      },
      update: {
        imageUrl: file.imageUrl,
        relativePath: file.relativePath,
        generatedAt,
      },
    });
  }

  async savePreviewImage(input: { png: Buffer; requestBaseUrl?: string }) {
    return this.writeImage(PREVIEW_TICKET_DIR, input.png, input.requestBaseUrl);
  }

  async isGeneratedImageUsable(relativePath: string | null | undefined) {
    const filePath = this.resolveGeneratedRelativePath(relativePath);

    if (!filePath) {
      return false;
    }

    try {
      const fileStat = await stat(filePath);

      return fileStat.isFile() && fileStat.size > 0;
    } catch {
      return false;
    }
  }

  async deleteGeneratedImage(relativePath: string | null | undefined) {
    return safeDeleteUploadFile(
      relativePath,
      GENERATED_TICKET_DIR,
      this.logger,
    );
  }

  private async writeImage(
    subdir: string,
    png: Buffer,
    requestBaseUrl?: string,
  ) {
    const filename = `${randomUUID()}.png`;
    const outputDir = join(this.uploadRoot, subdir);
    const filePath = join(outputDir, filename);
    const relativePath = `/uploads/${subdir}/${filename}`;

    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, png);

    return {
      filePath,
      relativePath,
      imageUrl: `${this.resolveBaseUrl(requestBaseUrl)}${relativePath}`,
    };
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

  private resolveGeneratedRelativePath(relativePath: string | null | undefined) {
    if (!relativePath) {
      return null;
    }

    const value = relativePath.trim().replace(/\\/g, '/');
    const expectedPrefix = `/uploads/${GENERATED_TICKET_DIR}/`;

    if (!value.startsWith(expectedPrefix)) {
      return null;
    }

    const parts = value.replace(/^\/+/, '').split('/');

    if (parts.some((part) => part === '..')) {
      return null;
    }

    const relativeWithinUploads = normalize(
      value.replace(/^\/uploads\//, ''),
    );
    const uploadRoot = resolve(this.uploadRoot);
    const generatedRoot = resolve(this.uploadRoot, GENERATED_TICKET_DIR);
    const filePath = resolve(this.uploadRoot, relativeWithinUploads);
    const withinUploadRoot =
      generatedRoot === uploadRoot ||
      generatedRoot.startsWith(`${uploadRoot}${sep}`);
    const withinGeneratedRoot =
      filePath === generatedRoot || filePath.startsWith(`${generatedRoot}${sep}`);

    return withinUploadRoot && withinGeneratedRoot ? filePath : null;
  }
}
