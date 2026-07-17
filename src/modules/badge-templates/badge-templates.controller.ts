import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { BadgeTemplatesService } from './badge-templates.service';
import type { UpsertBadgeTemplateDto } from './dto/badge-template.dto';
import { ListBadgeTemplatesQueryDto } from './dto/list-badge-templates-query.dto';

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

@Controller('badge-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class BadgeTemplatesController {
  private readonly logger = new Logger(BadgeTemplatesController.name);

  constructor(private readonly badgeTemplatesService: BadgeTemplatesService) {}

  @Post()
  async create(@Req() request: MultipartRequest) {
    const dto = await this.parseMultipartTemplate(request);

    try {
      return await this.badgeTemplatesService.create(dto);
    } catch (error) {
      await this.cleanupUploadedBadgeFile(dto);
      throw error;
    }
  }

  @Get()
  findAll(@Query() query: ListBadgeTemplatesQueryDto) {
    return this.badgeTemplatesService.findAll(query);
  }

  @Get('events/:eventId/available-fields')
  availableFields(@Param('eventId') eventId: string) {
    return this.badgeTemplatesService.availableFields(eventId);
  }

  @Get('events/:eventId/registrations/:registrationId')
  resolvedBadgeData(
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
  ) {
    return this.badgeTemplatesService.resolvedBadgeData(
      eventId,
      registrationId,
    );
  }

  @Get('events/:eventId')
  findByEvent(@Param('eventId') eventId: string) {
    return this.badgeTemplatesService.findByEvent(eventId);
  }

  @Patch('events/:eventId')
  async update(
    @Param('eventId') eventId: string,
    @Req() request: MultipartRequest,
    @Body() updateBadgeTemplateDto: UpsertBadgeTemplateDto,
  ) {
    const dto = request.isMultipart?.()
      ? await this.parseMultipartTemplate(request)
      : updateBadgeTemplateDto;

    try {
      return await this.badgeTemplatesService.update(eventId, dto);
    } catch (error) {
      await this.cleanupUploadedBadgeFile(dto);
      throw error;
    }
  }

  @Delete('events/:eventId')
  remove(@Param('eventId') eventId: string) {
    return this.badgeTemplatesService.remove(eventId);
  }

  @Delete('events/:eventId/background-image')
  removeBackgroundImage(@Param('eventId') eventId: string) {
    return this.badgeTemplatesService.removeBackgroundImage(eventId);
  }

  private async parseMultipartTemplate(request: MultipartRequest) {
    if (!request.isMultipart?.()) {
      throw new BadRequestException('multipart/form-data is required');
    }

    const dto: UpsertBadgeTemplateDto = {};
    const colors: Record<string, string> = {};

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'backgroundImage') {
          throw new BadRequestException(
            `Unsupported file field ${part.fieldname}`,
          );
        }

        dto.backgroundImageUrl = await this.saveBadgeTemplateFile(part);
        continue;
      }

      const value = typeof part.value === 'string' ? part.value : undefined;

      if (value === undefined || value.length === 0) {
        continue;
      }

      if (part.fieldname === 'eventId') {
        dto.eventId = value;
        continue;
      }

      if (part.fieldname === 'name') {
        dto.name = value;
        continue;
      }

      if (part.fieldname === 'widthMm' || part.fieldname === 'heightMm') {
        dto[part.fieldname] = this.parseInteger(value, part.fieldname);
        continue;
      }

      if (part.fieldname.startsWith('colors.')) {
        const key = part.fieldname.replace('colors.', '');

        if (key !== 'primary' && key !== 'text' && key !== 'background') {
          throw new BadRequestException(
            `Unsupported color field ${part.fieldname}`,
          );
        }

        colors[key] = value;
        continue;
      }

      if (part.fieldname === 'colors') {
        Object.assign(colors, this.parseJsonObject(value, 'colors'));
        continue;
      }

      if (part.fieldname === 'selectedFields') {
        dto.selectedFields = this.parseJsonArray(value, 'selectedFields');
        continue;
      }

      if (part.fieldname === 'layout') {
        dto.layout = this.parseJsonObject(value, 'layout');
        continue;
      }

      throw new BadRequestException(`Unsupported field ${part.fieldname}`);
    }

    if (Object.keys(colors).length > 0) {
      dto.colors = colors;
    }

    return dto;
  }

  private async saveBadgeTemplateFile(
    part: Extract<MultipartPart, { type: 'file' }>,
  ) {
    const extension = extname(part.filename).toLowerCase();
    const safeExtension = extension.length > 0 ? extension : '.bin';
    const filename = `${part.fieldname}-${randomUUID()}${safeExtension}`;
    const uploadDir = join(process.cwd(), 'uploads', 'badge-templates');
    const chunks: Buffer[] = [];

    for await (const chunk of part.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), Buffer.concat(chunks));

    return `/uploads/badge-templates/${filename}`;
  }

  private parseInteger(value: string, field: string) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`${field} must be an integer`);
    }

    return parsed;
  }

  private parseJsonObject(value: string, field: string) {
    const parsed = this.parseJson(value, field);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new BadRequestException(`${field} must be a JSON object`);
    }

    return parsed as Record<string, unknown>;
  }

  private parseJsonArray(value: string, field: string) {
    const parsed = this.parseJson(value, field);

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(`${field} must be a JSON array`);
    }

    return parsed;
  }

  private parseJson(value: string, field: string) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new BadRequestException(`${field} must be valid JSON`);
    }
  }

  private async cleanupUploadedBadgeFile(dto: UpsertBadgeTemplateDto) {
    await safeDeleteUploadFile(
      dto.backgroundImageUrl,
      'badge-templates',
      this.logger,
    );
  }
}
