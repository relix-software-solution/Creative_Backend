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
import { ImportsService } from './imports.service';

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

  @Post('registrations')
  async importRegistrations(
    @Req() request: MultipartRequest,
    @CurrentUser() user: AuthUser,
  ) {
    const uploadedFile = await request.file();

    if (!uploadedFile) {
      throw new BadRequestException('File is required');
    }

    const buffer = Buffer.concat(await this.readChunks(uploadedFile.file));
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
      generateQr: this.getBooleanField(fields, 'generateQr'),
      source:
        (this.getOptionalField(fields, 'source') as RegistrationSource) ??
        RegistrationSource.EXCEL_IMPORT,
      mapping: this.parseMapping(this.getOptionalField(fields, 'mapping')),
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

  private async readChunks(file: AsyncIterable<Buffer>) {
    const chunks: Buffer[] = [];

    for await (const chunk of file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return chunks;
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

    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getBooleanField(fields: Record<string, MultipartField>, key: string) {
    return this.getOptionalField(fields, key) === 'true';
  }

  private parseMapping(mapping?: string) {
    if (!mapping) {
      return undefined;
    }

    try {
      return JSON.parse(mapping);
    } catch {
      throw new BadRequestException('mapping must be valid JSON');
    }
  }
}
