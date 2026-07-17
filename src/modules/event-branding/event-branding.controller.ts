import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { safeDeleteUploadFile } from '../../common/utils/upload-file.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateEventBrandingDto } from './dto/create-event-branding.dto';
import { EventBrandingThemeDto } from './dto/event-branding-theme.dto';
import { UpdateEventBrandingDto } from './dto/update-event-branding.dto';
import { EventBrandingService } from './event-branding.service';

type MultipartPart =
  | {
      type: 'file';
      fieldname: string;
      filename: string;
      mimetype?: string;
      file: AsyncIterable<Buffer>;
    }
  | {
      type: 'field';
      fieldname: string;
      value?: unknown;
    };

type MultipartRequest = {
  isMultipart?: () => boolean;
  parts: () => AsyncIterable<MultipartPart>;
};

@Controller('event-branding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventBrandingController {
  private readonly logger = new Logger(EventBrandingController.name);

  constructor(private readonly eventBrandingService: EventBrandingService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  async create(@Req() request: MultipartRequest) {
    const dto = await this.parseMultipartBranding(request);

    if (!dto.eventId) {
      await this.cleanupUploadedBrandingFiles(dto);
      throw new BadRequestException('eventId is required');
    }

    try {
      return await this.eventBrandingService.create(
        dto as CreateEventBrandingDto,
      );
    } catch (error) {
      await this.cleanupUploadedBrandingFiles(dto);
      throw error;
    }
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  findAll() {
    return this.eventBrandingService.findAll();
  }

  @Get(':eventId')
  @Roles(UserRole.SUPER_ADMIN)
  findOne(@Param('eventId') eventId: string) {
    return this.eventBrandingService.findOne(eventId);
  }

  @Patch(':eventId')
  @Roles(UserRole.SUPER_ADMIN)
  async update(
    @Param('eventId') eventId: string,
    @Req() request: MultipartRequest,
    @Body() updateEventBrandingDto: UpdateEventBrandingDto,
  ) {
    const dto = request.isMultipart?.()
      ? await this.parseMultipartBranding(request)
      : updateEventBrandingDto;

    try {
      return await this.eventBrandingService.update(eventId, dto);
    } catch (error) {
      await this.cleanupUploadedBrandingFiles(dto);
      throw error;
    }
  }

  @Delete(':eventId')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('eventId') eventId: string) {
    return this.eventBrandingService.remove(eventId);
  }

  @Delete(':eventId/logo')
  @Roles(UserRole.SUPER_ADMIN)
  removeLogoImage(@Param('eventId') eventId: string) {
    return this.eventBrandingService.removeLogoImage(eventId);
  }

  @Delete(':eventId/background-image')
  @Roles(UserRole.SUPER_ADMIN)
  removeBackgroundImage(@Param('eventId') eventId: string) {
    return this.eventBrandingService.removeBackgroundImage(eventId);
  }

  @Delete(':eventId/certificate-image')
  @Roles(UserRole.SUPER_ADMIN)
  removeCertificateImage(@Param('eventId') eventId: string) {
    return this.eventBrandingService.removeCertificateImage(eventId);
  }

  private async parseMultipartBranding(request: MultipartRequest) {
    if (!request.isMultipart?.()) {
      throw new BadRequestException('multipart/form-data is required');
    }

    const dto: UpdateEventBrandingDto = {};
    const theme: EventBrandingThemeDto = {};

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const fileUrl = await this.saveBrandingFile(part);

        if (part.fieldname === 'logo') {
          dto.logoUrl = fileUrl;
          continue;
        }

        if (part.fieldname === 'backgroundImage') {
          dto.backgroundImageUrl = fileUrl;
          continue;
        }

        if (part.fieldname === 'certificateImage') {
          dto.certificateImageUrl = fileUrl;
          continue;
        }

        throw new BadRequestException(
          `Unsupported file field ${part.fieldname}`,
        );
      }

      const value = typeof part.value === 'string' ? part.value : undefined;

      if (value === undefined || value.length === 0) {
        continue;
      }

      if (part.fieldname === 'eventId') {
        dto.eventId = value;
        continue;
      }

      if (part.fieldname.startsWith('theme.')) {
        this.assignThemeField(theme, part.fieldname, value);
        continue;
      }

      throw new BadRequestException(`Unsupported field ${part.fieldname}`);
    }

    if (Object.keys(theme).length > 0) {
      dto.theme = theme;
    }

    return dto;
  }

  private async saveBrandingFile(
    part: Extract<MultipartPart, { type: 'file' }>,
  ) {
    const extension = extname(part.filename).toLowerCase();
    const safeExtension = extension.length > 0 ? extension : '.bin';
    const filename = `${part.fieldname}-${randomUUID()}${safeExtension}`;
    const uploadDir = join(process.cwd(), 'uploads', 'event-branding');
    const chunks: Buffer[] = [];

    for await (const chunk of part.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), Buffer.concat(chunks));

    return `/uploads/event-branding/${filename}`;
  }

  private assignThemeField(
    theme: EventBrandingThemeDto,
    fieldname: string,
    value: string,
  ) {
    const key = fieldname.replace('theme.', '');

    if (
      key !== 'primary' &&
      key !== 'primaryHover' &&
      key !== 'background' &&
      key !== 'text' &&
      key !== 'radius'
    ) {
      throw new BadRequestException(`Unsupported theme field ${fieldname}`);
    }

    theme[key as keyof EventBrandingThemeDto] = value;
  }

  private async cleanupUploadedBrandingFiles(dto: UpdateEventBrandingDto) {
    await Promise.all([
      safeDeleteUploadFile(dto.logoUrl, 'event-branding', this.logger),
      safeDeleteUploadFile(
        dto.backgroundImageUrl,
        'event-branding',
        this.logger,
      ),
      safeDeleteUploadFile(
        dto.certificateImageUrl,
        'event-branding',
        this.logger,
      ),
    ]);
  }
}
