import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RegistrationSource, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ListImportRowsQueryDto } from './dto/list-import-rows-query.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';
import {
  ImportDuplicateStrategy,
  ImportFileParserOptions,
  ImportMapping,
  ImportsService,
} from './imports.service';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

type MultipartField = { value?: unknown };
type MultipartRequest = {
  file: () => Promise<{
    filename: string;
    mimetype?: string;
    file: AsyncIterable<Buffer>;
    fields: Record<string, MultipartField>;
  } | undefined>;
};

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('registrations/preview')
  async previewRegistrations(@Req() request: MultipartRequest) {
    const uploadedFile = await request.file();

    if (!uploadedFile) {
      throw new BadRequestException('File is required');
    }

    const buffer = await this.readFileWithLimit(uploadedFile.file);
    const fields = uploadedFile.fields;

    return this.importsService.previewRegistrations({
      file: {
        buffer,
        filename: uploadedFile.filename,
        mimetype: uploadedFile.mimetype,
        size: buffer.length,
      },
      eventId: this.getRequiredField(fields, 'eventId'),
      attendeeTypeId: this.getOptionalField(fields, 'attendeeTypeId'),
      parser: this.getParserOptions(fields),
    });
  }

  @Post('registrations')
  async importRegistrations(
    @Req() request: MultipartRequest,
    @CurrentUser() user: AuthUser,
  ) {
    const uploadedFile = await request.file();

    if (!uploadedFile) {
      throw new BadRequestException('File is required');
    }

    const buffer = await this.readFileWithLimit(uploadedFile.file);
    const fields = uploadedFile.fields;

    return this.importsService.importRegistrations({
      file: {
        buffer,
        filename: uploadedFile.filename,
        mimetype: uploadedFile.mimetype,
        size: buffer.length,
      },
      eventId: this.getRequiredField(fields, 'eventId'),
      attendeeTypeId: this.getOptionalField(fields, 'attendeeTypeId'),
      generateQr: this.getBooleanField(fields, 'generateQr', true),
      source: this.getRegistrationSource(fields),
      duplicateStrategy: this.getDuplicateStrategy(fields),
      externalIdPrefix: this.getOptionalField(fields, 'externalIdPrefix'),
      mapping: this.parseMapping(this.getOptionalField(fields, 'mapping')),
      parser: this.getParserOptions(fields),
      uploadedByUserId: user.id,
    });
  }

  @Get()
  findAll(@Query() query: ListImportsQueryDto) {
    return this.importsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.importsService.findOne(id);
  }

  @Get(':id/rows')
  findRows(@Param('id') id: string, @Query() query: ListImportRowsQueryDto) {
    return this.importsService.findRows(id, query);
  }

  private async readFileWithLimit(file: AsyncIterable<Buffer>) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunkValue of file) {
      const chunk = Buffer.isBuffer(chunkValue)
        ? chunkValue
        : Buffer.from(chunkValue);

      totalBytes += chunk.length;

      if (totalBytes > MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException('File is too large');
      }

      chunks.push(chunk);
    }

    return Buffer.concat(chunks, totalBytes);
  }

  private getRequiredField(fields: Record<string, MultipartField>, key: string) {
    const value = this.getOptionalField(fields, key);

    if (!value) {
      throw new BadRequestException(`${key} is required`);
    }

    return value;
  }

  private getOptionalField(fields: Record<string, MultipartField>, key: string) {
    const value = fields[key]?.value;

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private getBooleanField(
    fields: Record<string, MultipartField>,
    key: string,
    defaultValue = false,
  ) {
    const value = this.getOptionalField(fields, key);

    if (value === undefined) {
      return defaultValue;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException(`${key} must be true or false`);
  }

  private getIntegerField(
    fields: Record<string, MultipartField>,
    key: string,
  ) {
    const value = this.getOptionalField(fields, key);

    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${key} must be a positive integer`);
    }

    return parsed;
  }

  private getParserOptions(
    fields: Record<string, MultipartField>,
  ): ImportFileParserOptions {
    return {
      sheetName: this.getOptionalField(fields, 'sheetName'),
      headerRow: this.getIntegerField(fields, 'headerRow'),
      dataStartRow: this.getIntegerField(fields, 'dataStartRow'),
    };
  }

  private getDuplicateStrategy(
    fields: Record<string, MultipartField>,
  ): ImportDuplicateStrategy {
    const value = this.getOptionalField(fields, 'duplicateStrategy') ?? 'SKIP';

    if (value === 'SKIP' || value === 'FAIL' || value === 'UPDATE_EXISTING') {
      return value;
    }

    throw new BadRequestException('Invalid duplicateStrategy');
  }

  private getRegistrationSource(fields: Record<string, MultipartField>) {
    const value =
      this.getOptionalField(fields, 'source') ??
      RegistrationSource.EXCEL_IMPORT;

    if (!Object.values(RegistrationSource).includes(value as RegistrationSource)) {
      throw new BadRequestException('Invalid registration source');
    }

    return value as RegistrationSource;
  }

  private parseMapping(mapping?: string): ImportMapping | undefined {
    if (!mapping) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(mapping) as unknown;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Mapping must be an object');
      }

      return parsed as ImportMapping;
    } catch {
      throw new BadRequestException('mapping must be valid JSON object');
    }
  }
}
