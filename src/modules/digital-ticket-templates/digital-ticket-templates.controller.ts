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
import { DigitalTicketsService } from '../digital-tickets/digital-tickets.service';
import { PreviewDigitalTicketDto } from '../digital-tickets/dto/preview-digital-ticket.dto';
import { DigitalTicketTemplatesService } from './digital-ticket-templates.service';
import type { UpsertDigitalTicketTemplateDto } from './dto/digital-ticket-template.dto';
import { ListDigitalTicketTemplatesQueryDto } from './dto/list-digital-ticket-templates-query.dto';

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

@Controller('digital-ticket-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DigitalTicketTemplatesController {
  private readonly logger = new Logger(DigitalTicketTemplatesController.name);

  constructor(
    private readonly digitalTicketTemplatesService: DigitalTicketTemplatesService,
    private readonly digitalTicketsService: DigitalTicketsService,
  ) {}

  @Post()
  async create(@Req() request: MultipartRequest) {
    const dto = await this.parseMultipartTemplate(request, true);

    try {
      return await this.digitalTicketTemplatesService.create(dto);
    } catch (error) {
      await this.cleanupUploadedBackground(dto);
      throw error;
    }
  }

  @Get()
  findAll(@Query() query: ListDigitalTicketTemplatesQueryDto) {
    return this.digitalTicketTemplatesService.findAll(query);
  }

  @Get('events/:eventId/available-fields')
  availableFields(@Param('eventId') eventId: string) {
    return this.digitalTicketTemplatesService.availableFields(eventId);
  }

  @Post('events/:eventId/preview')
  preview(
    @Param('eventId') eventId: string,
    @Body() dto: PreviewDigitalTicketDto,
  ) {
    return this.digitalTicketsService.previewForEvent(eventId, dto);
  }

  @Get('events/:eventId')
  findByEvent(@Param('eventId') eventId: string) {
    return this.digitalTicketTemplatesService.findByEvent(eventId);
  }

  @Get('events/:eventId/:attendeeTypeId')
  findByEventAndAttendeeType(
    @Param('eventId') eventId: string,
    @Param('attendeeTypeId') attendeeTypeId: string,
  ) {
    return this.digitalTicketTemplatesService.findByEventAndAttendeeType(
      eventId,
      attendeeTypeId,
    );
  }

  @Patch('events/:eventId')
  async updateEventWide(
    @Param('eventId') eventId: string,
    @Req() request: MultipartRequest,
    @Body() dto: UpsertDigitalTicketTemplateDto,
  ) {
    const parsed = request.isMultipart?.()
      ? await this.parseMultipartTemplate(request, false)
      : dto;

    try {
      return await this.digitalTicketTemplatesService.update(
        eventId,
        null,
        parsed,
      );
    } catch (error) {
      await this.cleanupUploadedBackground(parsed);
      throw error;
    }
  }

  @Patch('events/:eventId/:attendeeTypeId')
  async update(
    @Param('eventId') eventId: string,
    @Param('attendeeTypeId') attendeeTypeId: string,
    @Req() request: MultipartRequest,
    @Body() dto: UpsertDigitalTicketTemplateDto,
  ) {
    const parsed = request.isMultipart?.()
      ? await this.parseMultipartTemplate(request, false)
      : dto;

    try {
      return await this.digitalTicketTemplatesService.update(
        eventId,
        attendeeTypeId,
        parsed,
      );
    } catch (error) {
      await this.cleanupUploadedBackground(parsed);
      throw error;
    }
  }

  @Delete('events/:eventId/background-image')
  removeEventWideBackgroundImage(@Param('eventId') eventId: string) {
    return this.digitalTicketTemplatesService.removeBackgroundImage(
      eventId,
      null,
    );
  }

  @Delete('events/:eventId')
  removeEventWide(@Param('eventId') eventId: string) {
    return this.digitalTicketTemplatesService.remove(eventId, null);
  }

  @Delete('events/:eventId/:attendeeTypeId/background-image')
  removeBackgroundImage(
    @Param('eventId') eventId: string,
    @Param('attendeeTypeId') attendeeTypeId: string,
  ) {
    return this.digitalTicketTemplatesService.removeBackgroundImage(
      eventId,
      attendeeTypeId,
    );
  }

  @Delete('events/:eventId/:attendeeTypeId')
  remove(
    @Param('eventId') eventId: string,
    @Param('attendeeTypeId') attendeeTypeId: string,
  ) {
    return this.digitalTicketTemplatesService.remove(eventId, attendeeTypeId);
  }

  private async parseMultipartTemplate(
    request: MultipartRequest,
    requireMultipart: boolean,
  ) {
    if (!request.isMultipart?.()) {
      if (requireMultipart) {
        throw new BadRequestException('multipart/form-data is required');
      }

      return {};
    }

    const dto: UpsertDigitalTicketTemplateDto = {};

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'backgroundImage') {
          throw new BadRequestException(
            `Unsupported file field ${part.fieldname}`,
          );
        }

        const backgroundImage = await this.saveBackgroundImage(part);
        dto.backgroundImageUrl = backgroundImage.relativePath;
        dto.backgroundImagePath = backgroundImage.relativePath;
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

      if (part.fieldname === 'attendeeTypeId') {
        dto.attendeeTypeId = value;
        continue;
      }

      if (part.fieldname === 'name') {
        dto.name = value;
        continue;
      }

      if (part.fieldname === 'widthPx' || part.fieldname === 'heightPx') {
        dto[part.fieldname] = this.parseInteger(value, part.fieldname);
        continue;
      }

      if (part.fieldname === 'theme') {
        dto.theme = this.parseJsonObject(value, 'theme');
        continue;
      }

      if (part.fieldname === 'elements') {
        dto.elements = this.parseJsonArray(value, 'elements');
        continue;
      }

      if (part.fieldname === 'selectedFields') {
        dto.selectedFields = this.parseJsonArray(value, 'selectedFields');
        continue;
      }

      throw new BadRequestException(`Unsupported field ${part.fieldname}`);
    }

    return dto;
  }

  private async saveBackgroundImage(
    part: Extract<MultipartPart, { type: 'file' }>,
  ) {
    const extension = extname(part.filename).toLowerCase();
    const safeExtension = extension.length > 0 ? extension : '.bin';
    const filename = `${part.fieldname}-${randomUUID()}${safeExtension}`;
    const uploadDir = join(
      process.cwd(),
      'uploads',
      'digital-tickets',
      'templates',
    );
    const chunks: Buffer[] = [];

    for await (const chunk of part.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), Buffer.concat(chunks));

    return {
      relativePath: `/uploads/digital-tickets/templates/${filename}`,
    };
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

  private async cleanupUploadedBackground(
    dto: UpsertDigitalTicketTemplateDto,
  ) {
    const paths = Array.from(
      new Set(
        [dto.backgroundImageUrl, dto.backgroundImagePath].filter(
          (path): path is string => Boolean(path),
        ),
      ),
    );

    await Promise.all(
      paths.map((path) =>
        safeDeleteUploadFile(
          path,
          'digital-tickets/templates',
          this.logger,
        ),
      ),
    );
  }
}
