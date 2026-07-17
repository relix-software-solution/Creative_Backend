import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import {
  EventStatus,
  ImportJobStatus,
  ImportRow,
  ImportRowStatus,
  Prisma,
  RegistrationSource,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { CreateRegistrationDto } from '../registrations/dto/create-registration.dto';
import { RegistrationsService } from '../registrations/registrations.service';
import { ListImportRowsQueryDto } from './dto/list-import-rows-query.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';

const CHUNK_SIZE = 500;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

type ImportCommand = {
  file: {
    buffer: Buffer;
    filename: string;
    mimetype?: string;
    size: number;
  };
  eventId: string;
  attendeeTypeId?: string;
  generateQr: boolean;
  source: RegistrationSource;
  mapping?: ImportMapping;
  uploadedByUserId?: string;
};

type ImportProcessingContext = {
  eventId: string;
  attendeeTypeId?: string;
  generateQr: boolean;
  source: RegistrationSource;
  mapping?: ImportMapping;
};

type ImportMapping = {
  fullName?: string;
  phone?: string;
  email?: string;
  companyName?: string;
  jobTitle?: string;
  externalId?: string;
  attendeeTypeCode?: string;
  customFields?: Record<string, string>;
};

type ParsedRow = Record<string, unknown>;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.IMPORT_PROCESSING)
    private readonly importProcessingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS)
    private readonly whatsappNotificationsQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly registrationsService: RegistrationsService,
  ) {}

  async importRegistrations(command: ImportCommand) {
    const importJob = await this.createImportJobFromFile(command);

    if (!this.configService.get<boolean>('IMPORT_QUEUE_ENABLED', true)) {
      return {
        importJob: await this.processImportJob(importJob.id),
        queued: false,
      };
    }

    try {
      await this.importProcessingQueue.add(
        'import.process',
        { importJobId: importJob.id },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            count: 100,
          },
          removeOnFail: false,
        },
      );

      return { importJob, queued: true };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue import job ${importJob.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      const updatedImportJob = await this.prisma.importJob.update({
        where: { id: importJob.id },
        data: {
          summary: {
            queueError:
              error instanceof Error
                ? error.message
                : 'Failed to enqueue import',
          },
        },
      });

      return { importJob: updatedImportJob, queued: false };
    }
  }

  async createImportJobFromFile(command: ImportCommand) {
    await this.ensureEventCanBeModified(command.eventId);

    if (command.attendeeTypeId) {
      await this.ensureAttendeeTypeBelongsToEvent(
        command.attendeeTypeId,
        command.eventId,
      );
    }

    const rows = this.parseFile(command.file);

    return this.createJob(command, rows);
  }

  async processImportJob(importJobId: string) {
    const importJob = await this.prisma.importJob.findUnique({
      where: { id: importJobId },
    });

    if (!importJob) {
      throw new NotFoundException('Import job not found');
    }

    const options = this.toRecord(importJob.options);
    const context: ImportProcessingContext = {
      eventId: importJob.eventId,
      attendeeTypeId: importJob.attendeeTypeId ?? undefined,
      generateQr: options.generateQr === true,
      source:
        typeof options.source === 'string'
          ? (options.source as RegistrationSource)
          : RegistrationSource.EXCEL_IMPORT,
      mapping: this.toRecord(options.mapping) as ImportMapping,
    };

    return this.processJob(importJob.id, context);
  }

  async findAll(query: ListImportsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.ImportJobWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importJob.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true, status: true },
        },
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    return job;
  }

  async findRows(importJobId: string, query: ListImportRowsQueryDto) {
    await this.findOne(importJobId);

    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.ImportRowWhereInput = {
      importJobId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { rowNumber: 'asc' },
      }),
      this.prisma.importRow.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  private async createJob(command: ImportCommand, rows: ParsedRow[]) {
    return this.prisma.importJob.create({
      data: {
        eventId: command.eventId,
        attendeeTypeId: command.attendeeTypeId,
        uploadedByUserId: command.uploadedByUserId,
        fileName: command.file.filename,
        fileMimeType: command.file.mimetype,
        fileSizeBytes: command.file.size,
        status: ImportJobStatus.PENDING,
        totalRows: rows.length,
        options: {
          generateQr: command.generateQr,
          source: command.source,
          mapping: command.mapping ?? null,
        },
        rows: {
          create: rows.map((row, index) => ({
            rowNumber: index + 2,
            rawData: row as Prisma.InputJsonValue,
          })),
        },
      },
    });
  }

  private async processJob(
    importJobId: string,
    context: ImportProcessingContext,
  ) {
    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: ImportJobStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    let successRows = 0;
    let failedRows = 0;
    let duplicateRows = 0;
    let processedRows = 0;
    let offset = 0;
    const chunkSize = this.configService.get<number>(
      'WHATSAPP_IMPORT_ENQUEUE_BATCH_SIZE',
      CHUNK_SIZE,
    );

    while (true) {
      const rows = await this.prisma.importRow.findMany({
        where: { importJobId },
        orderBy: { rowNumber: 'asc' },
        skip: offset,
        take: chunkSize,
      });

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const result = await this.processImportRow(row, context);
        processedRows += 1;

        if (result === ImportRowStatus.PROCESSED) {
          successRows += 1;
        } else if (result === ImportRowStatus.DUPLICATE) {
          duplicateRows += 1;
        } else if (result === ImportRowStatus.FAILED) {
          failedRows += 1;
        }
      }

      offset += chunkSize;
      await this.waitForWhatsAppBackpressure();
    }

    const status = this.getJobStatus(successRows, failedRows, duplicateRows);
    const summary = { successRows, failedRows, duplicateRows, processedRows };

    return this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status,
        processedRows,
        successRows,
        failedRows,
        duplicateRows,
        summary,
        completedAt: new Date(),
      },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true, status: true },
        },
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });
  }

  async processImportRow(row: ImportRow, context: ImportProcessingContext) {
    try {
      const normalizedData = await this.normalizeRow(
        row.rawData as Record<string, unknown>,
        context,
      );
      const registration = await this.registrationsService.create({
        ...normalizedData,
        source: context.source,
      } satisfies CreateRegistrationDto);
      const output: Record<string, unknown> = {
        registrationId: registration.id,
        publicId: registration.publicId,
      };

      await this.prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: ImportRowStatus.PROCESSED,
          normalizedData: {
            ...normalizedData,
            output,
          } as Prisma.InputJsonValue,
          registrationId: registration.id,
          processedAt: new Date(),
        },
      });

      return ImportRowStatus.PROCESSED;
    } catch (error) {
      const duplicate = error instanceof ConflictException;
      const status = duplicate
        ? ImportRowStatus.DUPLICATE
        : ImportRowStatus.FAILED;

      await this.prisma.importRow.update({
        where: { id: row.id },
        data: {
          status,
          errorCode: duplicate ? 'DUPLICATE_REGISTRATION' : 'ROW_FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Row processing failed',
          processedAt: new Date(),
        },
      });

      return status;
    }
  }

  private async normalizeRow(
    rawData: ParsedRow,
    command: ImportProcessingContext,
  ) {
    const registrationFields = await this.prisma.registrationField.findMany({
      where: {
        eventId: command.eventId,
        isActive: true,
      },
    });
    const attendeeTypeId =
      command.attendeeTypeId ??
      (await this.resolveAttendeeTypeId(rawData, command, registrationFields));
    const customFields: Record<string, unknown> = {};

    for (const field of registrationFields) {
      const header =
        command.mapping?.customFields?.[field.key] ??
        this.findHeader(rawData, [field.key]);

      if (header && rawData[header] !== undefined && rawData[header] !== '') {
        customFields[field.key] = rawData[header];
      }
    }

    return {
      eventId: command.eventId,
      attendeeTypeId,
      fullName: this.getMappedValue(rawData, command.mapping?.fullName, [
        'full_name',
        'full name',
        'name',
        'name ar',
        'name en',
      ]),
      phone: this.getMappedValue(
        rawData,
        command.mapping?.phone,
        ['phone', 'mobile', 'whatsapp'],
        'phone',
      ),
      email: this.getOptionalMappedValue(rawData, command.mapping?.email, [
        'email',
        'mail',
      ]),
      companyName: this.getOptionalMappedValue(
        rawData,
        command.mapping?.companyName,
        ['company', 'company_name'],
      ),
      jobTitle: this.getOptionalMappedValue(
        rawData,
        command.mapping?.jobTitle,
        ['job_title', 'position', 'title'],
      ),
      externalId: this.getOptionalMappedValue(
        rawData,
        command.mapping?.externalId,
        ['external_id', 'id'],
      ),
      customFields,
    };
  }

  private parseFile(file: ImportCommand['file']): ParsedRow[] {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File is too large');
    }

    const lowerName = file.filename.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      return parseCsv(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as ParsedRow[];
    }

    if (lowerName.endsWith('.xlsx')) {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        return [];
      }

      return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
        defval: '',
      }) as ParsedRow[];
    }

    throw new BadRequestException('Unsupported import file');
  }

  private async resolveAttendeeTypeId(
    rawData: ParsedRow,
    command: ImportProcessingContext,
    registrationFields: Array<{ key: string }>,
  ) {
    const attendeeTypeCode = this.getOptionalMappedValue(
      rawData,
      command.mapping?.attendeeTypeCode,
      ['attendee_type_code', 'attendee type code', 'attendee type'],
    );

    if (attendeeTypeCode) {
      const attendeeType = await this.prisma.attendeeType.findFirst({
        where: {
          eventId: command.eventId,
          code: attendeeTypeCode.trim().toUpperCase(),
          isActive: true,
        },
      });

      if (!attendeeType) {
        throw new BadRequestException('Attendee type code was not found');
      }

      return attendeeType.id;
    }

    const defaultAttendeeType = await this.prisma.attendeeType.findFirst({
      where: {
        eventId: command.eventId,
        isDefault: true,
        isActive: true,
      },
    });

    if (!defaultAttendeeType) {
      throw new BadRequestException('Default attendee type was not found');
    }

    return defaultAttendeeType.id;
  }

  private getMappedValue(
    rawData: ParsedRow,
    mappedHeader: string | undefined,
    fallbackHeaders: string[],
    field = 'fullName',
  ) {
    const value = this.getOptionalMappedValue(
      rawData,
      mappedHeader,
      fallbackHeaders,
    );

    if (!value) {
      throw new BadRequestException(`${field} is required`);
    }

    return value;
  }

  private getOptionalMappedValue(
    rawData: ParsedRow,
    mappedHeader: string | undefined,
    fallbackHeaders: string[],
  ) {
    const header = mappedHeader ?? this.findHeader(rawData, fallbackHeaders);
    const value = header ? rawData[header] : undefined;

    return value === undefined || value === null || value === ''
      ? undefined
      : String(value).trim();
  }

  private findHeader(rawData: ParsedRow, candidates: string[]) {
    const headers = Object.keys(rawData);
    const normalizedCandidates = candidates.map((candidate) =>
      this.normalizeHeader(candidate),
    );

    return headers.find((header) =>
      normalizedCandidates.includes(this.normalizeHeader(header)),
    );
  }

  private normalizeHeader(header: string) {
    return header
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private async ensureEventCanBeModified(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }
  }

  private async ensureAttendeeTypeBelongsToEvent(
    attendeeTypeId: string,
    eventId: string,
  ) {
    const attendeeType = await this.prisma.attendeeType.findUnique({
      where: { id: attendeeTypeId },
    });

    if (!attendeeType) {
      throw new NotFoundException('Attendee type not found');
    }

    if (attendeeType.eventId !== eventId) {
      throw new BadRequestException(
        'Attendee type must belong to the same event',
      );
    }
  }

  private getJobStatus(
    successRows: number,
    failedRows: number,
    duplicateRows: number,
  ) {
    if (failedRows === 0) {
      return ImportJobStatus.COMPLETED;
    }

    if (successRows === 0 && duplicateRows === 0) {
      return ImportJobStatus.FAILED;
    }

    return ImportJobStatus.PARTIAL_FAILED;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private async waitForWhatsAppBackpressure() {
    if (
      !this.configService.get<boolean>(
        'WHATSAPP_QUEUE_BACKPRESSURE_ENABLED',
        true,
      )
    ) {
      return;
    }

    const maxWaiting = this.configService.get<number>(
      'WHATSAPP_QUEUE_MAX_WAITING',
      10000,
    );
    const resumeThreshold = this.configService.get<number>(
      'WHATSAPP_QUEUE_RESUME_THRESHOLD',
      5000,
    );

    const initialCounts = await this.whatsappNotificationsQueue.getJobCounts(
      'waiting',
      'delayed',
    );
    let depth =
      (initialCounts.waiting ?? 0) + (initialCounts.delayed ?? 0);

    if (depth < maxWaiting) {
      return;
    }

    while (depth > resumeThreshold) {
      this.logger.warn(
        `Import backpressure waiting: WhatsApp queue depth ${depth}; resume threshold is ${resumeThreshold}`,
      );
      await this.delay(5000);

      const counts = await this.whatsappNotificationsQueue.getJobCounts(
        'waiting',
        'delayed',
      );
      depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
