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
  AttendeeType,
  Event,
  EventStatus,
  ImportJobStatus,
  ImportRow,
  ImportRowStatus,
  Prisma,
  RegistrationField,
  RegistrationFieldType,
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
import {
  CreateImportRegistrationInput,
  RegistrationsService,
} from '../registrations/registrations.service';
import { ListImportRowsQueryDto } from './dto/list-import-rows-query.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';

const CHUNK_SIZE = 500;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PREVIEW_ROWS_LIMIT = 25;
const HEADER_SCAN_LIMIT = 40;

export type ImportDuplicateStrategy = 'SKIP' | 'FAIL' | 'UPDATE_EXISTING';

export type ImportMapping = {
  fullName?: string;
  phone?: string;
  email?: string;
  companyName?: string;
  jobTitle?: string;
  externalId?: string;
  notes?: string;
  attendeeTypeCode?: string;
  customFields?: Record<string, string>;
};

export type ImportFileParserOptions = {
  sheetName?: string;
  headerRow?: number;
  dataStartRow?: number;
};

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
  duplicateStrategy: ImportDuplicateStrategy;
  externalIdPrefix?: string;
  mapping?: ImportMapping;
  parser?: ImportFileParserOptions;
  uploadedByUserId?: string;
};

type PreviewImportCommand = {
  file: ImportCommand['file'];
  eventId: string;
  attendeeTypeId?: string;
  parser?: ImportFileParserOptions;
};

type ParsedRow = Record<string, unknown>;

type ParsedImportRow = {
  rowNumber: number;
  data: ParsedRow;
};

type ImportHeader = {
  key: string;
  label: string;
  columnIndex: number;
  columnLetter: string;
  sampleValues: string[];
};

type ParsedImportFile = {
  sheets: string[];
  selectedSheetName: string;
  detectedHeaderRow: number;
  headerRow: number;
  dataStartRow: number;
  headers: ImportHeader[];
  rows: ParsedImportRow[];
};

export type ImportProcessingContext = {
  event: Event;
  eventId: string;
  attendeeTypeId?: string;
  generateQr: boolean;
  source: RegistrationSource;
  duplicateStrategy: ImportDuplicateStrategy;
  externalIdPrefix?: string;
  mapping: ImportMapping;
  registrationFields: RegistrationField[];
  attendeeTypes: AttendeeType[];
  attendeeTypesByCode: Map<string, AttendeeType>;
  attendeeTypeIds: Set<string>;
  defaultAttendeeTypeId?: string;
};

type ExistingRegistrationMatch = {
  id: string;
  customFields: Prisma.JsonValue;
  fullName: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  jobTitle: string | null;
  externalId: string | null;
  notes: string | null;
  attendeeTypeId: string;
};

type PreviewWarning = {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  rowNumbers?: number[];
};

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

  async previewRegistrations(command: PreviewImportCommand) {
    await this.ensureEventCanBeModified(command.eventId);

    if (command.attendeeTypeId) {
      await this.ensureAttendeeTypeBelongsToEvent(
        command.attendeeTypeId,
        command.eventId,
      );
    }

    const parsed = this.parseFile(command.file, command.parser);

    const registrationFields = await this.findRegistrationFieldsForImport(
      command.eventId,
      command.attendeeTypeId,
    );

    const suggestedMapping = this.suggestMapping(
      parsed.headers,
      parsed.rows,
      registrationFields,
    );

    const warnings = this.buildPreviewWarnings({
      parsed,
      suggestedMapping,
      registrationFields,
      attendeeTypeId: command.attendeeTypeId,
    });

    return {
      file: {
        name: command.file.filename,
        size: command.file.size,
        mimeType: command.file.mimetype ?? null,
      },
      sheets: parsed.sheets,
      selectedSheetName: parsed.selectedSheetName,
      detectedHeaderRow: parsed.detectedHeaderRow,
      headerRow: parsed.headerRow,
      dataStartRow: parsed.dataStartRow,
      totalRows: parsed.rows.length,
      headers: parsed.headers,
      previewRows: parsed.rows.slice(0, PREVIEW_ROWS_LIMIT).map((row) => ({
        rowNumber: row.rowNumber,
        values: row.data,
      })),
      suggestedMapping,
      availableFields: {
        system: [
          {
            key: 'fullName',
            labelAr: 'الاسم الكامل',
            required: true,
          },
          {
            key: 'phone',
            labelAr: 'رقم الهاتف',
            required: false,
          },
          {
            key: 'email',
            labelAr: 'البريد الإلكتروني',
            required: false,
          },
          {
            key: 'companyName',
            labelAr: 'اسم الشركة',
            required: false,
          },
          {
            key: 'jobTitle',
            labelAr: 'المسمى الوظيفي',
            required: false,
          },
          {
            key: 'externalId',
            labelAr: 'المعرف الخارجي',
            required: false,
          },
          {
            key: 'notes',
            labelAr: 'ملاحظات',
            required: false,
          },
          {
            key: 'attendeeTypeCode',
            labelAr: 'كود نوع الحضور',
            required: false,
          },
        ],
        custom: registrationFields.map((field) => ({
          key: field.key,
          labelAr: field.labelAr,
          labelEn: field.labelEn,
          type: field.type,
          required: field.isRequired,
          attendeeTypeId: field.attendeeTypeId,
        })),
      },
      warnings,
    };
  }

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
          jobId: `import-${importJob.id}`,
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
          status: ImportJobStatus.FAILED,
          completedAt: new Date(),
          summary: {
            queueError:
              error instanceof Error
                ? error.message
                : 'Failed to enqueue import',
          },
        },
        include: this.importJobInclude,
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

    const parsed = this.parseFile(command.file, command.parser);

    if (parsed.rows.length === 0) {
      throw new BadRequestException('No data rows were found in the file');
    }

    const registrationFields = await this.findRegistrationFieldsForImport(
      command.eventId,
      command.attendeeTypeId,
    );

    const normalizedMapping = this.normalizeMapping(
      command.mapping ??
        this.suggestMapping(parsed.headers, parsed.rows, registrationFields),
    );

    this.validateMapping({
      mapping: normalizedMapping,
      headers: parsed.headers,
      registrationFields,
      attendeeTypeId: command.attendeeTypeId,
    });

    return this.createJob(
      {
        ...command,
        mapping: normalizedMapping,
        parser: {
          sheetName: parsed.selectedSheetName,
          headerRow: parsed.headerRow,
          dataStartRow: parsed.dataStartRow,
        },
      },
      parsed.rows,
    );
  }

  async processImportJob(importJobId: string) {
    const importJob = await this.prisma.importJob.findUnique({
      where: { id: importJobId },
    });

    if (!importJob) {
      throw new NotFoundException('Import job not found');
    }

    if (
      importJob.status === ImportJobStatus.COMPLETED ||
      importJob.status === ImportJobStatus.PARTIAL_FAILED ||
      importJob.status === ImportJobStatus.FAILED ||
      importJob.status === ImportJobStatus.CANCELLED
    ) {
      return this.findOne(importJob.id);
    }

    const options = this.toRecord(importJob.options);
    const mapping = this.normalizeMapping(
      this.toRecord(options.mapping) as ImportMapping,
    );

    const [event, registrationFields, attendeeTypes] = await Promise.all([
      this.ensureEventCanBeModified(importJob.eventId),
      this.prisma.registrationField.findMany({
        where: {
          eventId: importJob.eventId,
          isActive: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.attendeeType.findMany({
        where: {
          eventId: importJob.eventId,
          isActive: true,
        },
      }),
    ]);

    if (attendeeTypes.length === 0) {
      throw new BadRequestException('No active attendee types were found');
    }

    const attendeeTypesByCode = new Map(
      attendeeTypes.map((type) => [type.code.trim().toUpperCase(), type]),
    );

    const attendeeTypeIds = new Set(attendeeTypes.map((type) => type.id));

    if (
      importJob.attendeeTypeId &&
      !attendeeTypeIds.has(importJob.attendeeTypeId)
    ) {
      throw new BadRequestException(
        'Selected attendee type is not active for this event',
      );
    }

    const context: ImportProcessingContext = {
      event,
      eventId: importJob.eventId,
      attendeeTypeId: importJob.attendeeTypeId ?? undefined,
      generateQr: options.generateQr !== false,
      source:
        typeof options.source === 'string'
          ? (options.source as RegistrationSource)
          : RegistrationSource.EXCEL_IMPORT,
      duplicateStrategy: this.parseDuplicateStrategy(
        options.duplicateStrategy,
      ),
      externalIdPrefix:
        typeof options.externalIdPrefix === 'string'
          ? options.externalIdPrefix
          : undefined,
      mapping,
      registrationFields,
      attendeeTypes,
      attendeeTypesByCode,
      attendeeTypeIds,
      defaultAttendeeTypeId: attendeeTypes.find((type) => type.isDefault)?.id,
    };

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: ImportJobStatus.PROCESSING,
        startedAt: importJob.startedAt ?? new Date(),
      },
    });

    const chunkSize = Math.max(
      50,
      this.configService.get<number>(
        'WHATSAPP_IMPORT_ENQUEUE_BATCH_SIZE',
        CHUNK_SIZE,
      ),
    );

    while (true) {
      const rows = await this.prisma.importRow.findMany({
        where: {
          importJobId,
          status: ImportRowStatus.PENDING,
        },
        orderBy: { rowNumber: 'asc' },
        take: chunkSize,
      });

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        await this.processImportRow(row, context);
      }

      if (context.generateQr) {
        await this.waitForWhatsAppBackpressure();
      }
    }

    return this.finalizeImportJob(importJobId);
  }

  async findAll(query: ListImportsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);

    const where: Prisma.ImportJobWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId
        ? { attendeeTypeId: query.attendeeTypeId }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.importJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.importJobInclude,
      }),
      this.prisma.importJob.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: this.importJobInclude,
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

  async processImportRow(row: ImportRow, context: ImportProcessingContext) {
    try {
      const normalizedData = await this.normalizeRow(
        row.rawData as ParsedRow,
        context,
      );

      const existing = await this.findExistingRegistration(normalizedData);

      if (existing) {
        return this.handleExistingRegistration(
          row,
          normalizedData,
          existing,
          context,
        );
      }

      try {
        const registration = await this.registrationsService.createFromImport(
          {
            ...normalizedData,
            source: context.source,
          },
          {
            event: context.event,
            attendeeTypeIds: context.attendeeTypeIds,
            registrationFields: context.registrationFields,
            enqueuePipeline: context.generateQr,
          },
        );

        await this.markRowProcessed(row.id, normalizedData, {
          action: 'CREATED',
          registrationId: registration.id,
          publicId: registration.publicId,
        });

        return ImportRowStatus.PROCESSED;
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }

        const racedExisting = await this.findExistingRegistration(
          normalizedData,
        );

        if (!racedExisting) {
          throw error;
        }

        return this.handleExistingRegistration(
          row,
          normalizedData,
          racedExisting,
          context,
        );
      }
    } catch (error) {
      await this.prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: ImportRowStatus.FAILED,
          errorCode:
            error instanceof BadRequestException
              ? 'VALIDATION_FAILED'
              : error instanceof ConflictException
                ? 'DUPLICATE_REGISTRATION'
                : 'ROW_FAILED',
          errorMessage: this.getExceptionMessage(error),
          processedAt: new Date(),
        },
      });

      return ImportRowStatus.FAILED;
    }
  }

  private async handleExistingRegistration(
    row: ImportRow,
    normalizedData: CreateImportRegistrationInput,
    existing: ExistingRegistrationMatch,
    context: ImportProcessingContext,
  ) {
    if (context.duplicateStrategy === 'FAIL') {
      throw new ConflictException('Duplicate registration for this event');
    }

    if (context.duplicateStrategy === 'UPDATE_EXISTING') {
      const existingCustomFields = this.toRecord(existing.customFields);

      const updated = await this.registrationsService.update(existing.id, {
        attendeeTypeId: normalizedData.attendeeTypeId,
        fullName: normalizedData.fullName,
        ...(normalizedData.phone ? { phone: normalizedData.phone } : {}),
        ...(normalizedData.email ? { email: normalizedData.email } : {}),
        ...(normalizedData.companyName
          ? { companyName: normalizedData.companyName }
          : {}),
        ...(normalizedData.jobTitle
          ? { jobTitle: normalizedData.jobTitle }
          : {}),
        ...(normalizedData.externalId
          ? { externalId: normalizedData.externalId }
          : {}),
        ...(normalizedData.notes ? { notes: normalizedData.notes } : {}),
        customFields: {
          ...existingCustomFields,
          ...(normalizedData.customFields ?? {}),
        },
      });

      await this.markRowProcessed(row.id, normalizedData, {
        action: 'UPDATED_EXISTING',
        registrationId: updated.id,
        publicId: updated.publicId,
      });

      return ImportRowStatus.PROCESSED;
    }

    await this.prisma.importRow.update({
      where: { id: row.id },
      data: {
        status: ImportRowStatus.DUPLICATE,
        normalizedData: {
          ...normalizedData,
          output: {
            action: 'SKIPPED_DUPLICATE',
            registrationId: existing.id,
          },
        } as Prisma.InputJsonValue,
        registrationId: existing.id,
        errorCode: 'DUPLICATE_REGISTRATION',
        errorMessage: 'Registration already exists for this event',
        processedAt: new Date(),
      },
    });

    return ImportRowStatus.DUPLICATE;
  }

  private async markRowProcessed(
    rowId: string,
    normalizedData: CreateImportRegistrationInput,
    output: Record<string, unknown>,
  ) {
    await this.prisma.importRow.update({
      where: { id: rowId },
      data: {
        status: ImportRowStatus.PROCESSED,
        normalizedData: {
          ...normalizedData,
          output,
        } as Prisma.InputJsonValue,
        registrationId: String(output.registrationId),
        errorCode: null,
        errorMessage: null,
        processedAt: new Date(),
      },
    });
  }

  private async finalizeImportJob(importJobId: string) {
    const grouped = await this.prisma.importRow.groupBy({
      by: ['status'],
      where: { importJobId },
      _count: {
        _all: true,
      },
    });

    const counts = new Map(
      grouped.map((item) => [item.status, item._count._all]),
    );

    const successRows = counts.get(ImportRowStatus.PROCESSED) ?? 0;
    const failedRows = counts.get(ImportRowStatus.FAILED) ?? 0;
    const duplicateRows = counts.get(ImportRowStatus.DUPLICATE) ?? 0;
    const skippedRows = counts.get(ImportRowStatus.SKIPPED) ?? 0;
    const pendingRows = counts.get(ImportRowStatus.PENDING) ?? 0;
    const processedRows =
      successRows + failedRows + duplicateRows + skippedRows;

    const status = this.getJobStatus({
      successRows,
      failedRows,
      duplicateRows,
      skippedRows,
      pendingRows,
    });

    return this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status,
        processedRows,
        successRows,
        failedRows,
        duplicateRows,
        summary: {
          successRows,
          failedRows,
          duplicateRows,
          skippedRows,
          pendingRows,
          processedRows,
        },
        completedAt: pendingRows === 0 ? new Date() : null,
      },
      include: this.importJobInclude,
    });
  }

  private async createJob(
    command: ImportCommand,
    rows: ParsedImportRow[],
  ) {
    const importJob = await this.prisma.importJob.create({
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
          duplicateStrategy: command.duplicateStrategy,
          externalIdPrefix: command.externalIdPrefix ?? null,
          mapping: command.mapping ?? null,
          parser: command.parser ?? null,
        },
      },
      include: this.importJobInclude,
    });

    try {
      for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CHUNK_SIZE);

        await this.prisma.importRow.createMany({
          data: chunk.map((row) => ({
            importJobId: importJob.id,
            rowNumber: row.rowNumber,
            rawData: row.data as Prisma.InputJsonValue,
          })),
        });
      }

      return importJob;
    } catch (error) {
      await this.prisma.importRow.deleteMany({
        where: { importJobId: importJob.id },
      });

      await this.prisma.importJob.delete({
        where: { id: importJob.id },
      });

      throw error;
    }
  }

  private async normalizeRow(
    rawData: ParsedRow,
    context: ImportProcessingContext,
  ): Promise<CreateImportRegistrationInput> {
    const attendeeTypeId =
      context.attendeeTypeId ??
      this.resolveAttendeeTypeId(rawData, context);

    const applicableFields = context.registrationFields.filter(
      (field) =>
        field.attendeeTypeId === null ||
        field.attendeeTypeId === attendeeTypeId,
    );

    const customFields: Record<string, unknown> = {};

    for (const field of applicableFields) {
      const header =
        context.mapping.customFields?.[field.key] ??
        this.findHeader(rawData, [field.key, field.labelAr, field.labelEn ?? '']);

      if (!header) {
        continue;
      }

      const rawValue = rawData[header];

      if (this.isBlank(rawValue)) {
        continue;
      }

      customFields[field.key] = this.normalizeCustomFieldValue(field, rawValue);
    }

    const externalIdValue = this.getOptionalMappedValue(
      rawData,
      context.mapping.externalId,
      [
        'external_id',
        'external id',
        'registration id',
        'serial',
        'serial number',
        'رقم تسلسلي',
        'المعرف الخارجي',
      ],
    );

    const externalId = externalIdValue
      ? `${context.externalIdPrefix ?? ''}${externalIdValue}`
      : undefined;

    return {
      eventId: context.eventId,
      attendeeTypeId,
      fullName: this.getMappedValue(
        rawData,
        context.mapping.fullName,
        [
          'full_name',
          'full name',
          'name',
          'visitor name',
          'attendee name',
          'الاسم',
          'الاسم الكامل',
          'اسم الزائر',
          'اسم الحضور',
        ],
        'fullName',
      ),
      phone:
        this.getOptionalMappedValue(rawData, context.mapping.phone, [
          'phone',
          'mobile',
          'whatsapp',
          'phone number',
          'mobile number',
          'رقم الهاتف',
          'الهاتف',
          'الموبايل',
          'واتساب',
        ]) ?? null,
      email:
        this.getOptionalMappedValue(rawData, context.mapping.email, [
          'email',
          'mail',
          'email address',
          'البريد الإلكتروني',
          'البريد الالكتروني',
        ]) ?? null,
      companyName: this.getOptionalMappedValue(
        rawData,
        context.mapping.companyName,
        [
          'company',
          'company_name',
          'company name',
          'organization',
          'اسم الشركة',
          'الشركة',
          'الجهة',
        ],
      ),
      jobTitle: this.getOptionalMappedValue(
        rawData,
        context.mapping.jobTitle,
        [
          'job_title',
          'job title',
          'position',
          'title',
          'occupation',
          'المسمى الوظيفي',
          'المنصب',
          'الوظيفة',
        ],
      ),
      externalId,
      notes: this.getOptionalMappedValue(rawData, context.mapping.notes, [
        'notes',
        'note',
        'remarks',
        'ملاحظات',
        'ملاحظة',
      ]),
      customFields,
    };
  }

  private resolveAttendeeTypeId(
    rawData: ParsedRow,
    context: ImportProcessingContext,
  ) {
    const attendeeTypeCode = this.getOptionalMappedValue(
      rawData,
      context.mapping.attendeeTypeCode,
      [
        'attendee_type_code',
        'attendee type code',
        'attendee type',
        'type code',
        'كود نوع الحضور',
        'نوع الحضور',
      ],
    );

    if (attendeeTypeCode) {
      const attendeeType = context.attendeeTypesByCode.get(
        attendeeTypeCode.trim().toUpperCase(),
      );

      if (!attendeeType) {
        throw new BadRequestException('Attendee type code was not found');
      }

      return attendeeType.id;
    }

    if (!context.defaultAttendeeTypeId) {
      throw new BadRequestException('Default attendee type was not found');
    }

    return context.defaultAttendeeTypeId;
  }

  private async findExistingRegistration(
    normalizedData: CreateImportRegistrationInput,
  ): Promise<ExistingRegistrationMatch | null> {
    const checks: Prisma.RegistrationWhereInput[] = [];

    if (normalizedData.externalId) {
      checks.push({ externalId: normalizedData.externalId });
    }

    if (normalizedData.phone) {
      checks.push({ phone: normalizedData.phone });
    }

    if (normalizedData.email) {
      checks.push({ email: normalizedData.email });
    }

    if (checks.length === 0) {
      return null;
    }

    const matches = await this.prisma.registration.findMany({
      where: {
        eventId: normalizedData.eventId,
        OR: checks,
      },
      take: 3,
      select: {
        id: true,
        customFields: true,
        fullName: true,
        phone: true,
        email: true,
        companyName: true,
        jobTitle: true,
        externalId: true,
        notes: true,
        attendeeTypeId: true,
      },
    });

    const uniqueIds = new Set(matches.map((match) => match.id));

    if (uniqueIds.size > 1) {
      throw new ConflictException(
        'Multiple registrations match the imported identifiers',
      );
    }

    return matches[0] ?? null;
  }

  private parseFile(
    file: ImportCommand['file'],
    parser?: ImportFileParserOptions,
  ): ParsedImportFile {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File is too large');
    }

    const workbook = this.readWorkbook(file);
    const selectedSheetName = parser?.sheetName?.trim() || workbook.sheets[0];

    if (!selectedSheetName || !workbook.matrices.has(selectedSheetName)) {
      throw new BadRequestException('Selected sheet was not found');
    }

    const matrix = workbook.matrices.get(selectedSheetName) ?? [];

    if (matrix.length === 0) {
      throw new BadRequestException('Selected sheet is empty');
    }

    const detectedHeaderRow = this.detectHeaderRow(matrix);
    const headerRow = parser?.headerRow ?? detectedHeaderRow;

    if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > matrix.length) {
      throw new BadRequestException('headerRow is invalid');
    }

    const dataStartRow = parser?.dataStartRow ?? headerRow + 1;

    if (
      !Number.isInteger(dataStartRow) ||
      dataStartRow <= headerRow ||
      dataStartRow > matrix.length + 1
    ) {
      throw new BadRequestException('dataStartRow is invalid');
    }

    const headerValues = matrix[headerRow - 1] ?? [];
    const dataMatrix = matrix.slice(dataStartRow - 1);
    const columnCount = Math.max(
      headerValues.length,
      ...dataMatrix.slice(0, 100).map((row) => row.length),
    );

    const baseHeaders = this.buildHeaders(headerValues, columnCount);

    const rows: ParsedImportRow[] = [];

    for (let index = dataStartRow - 1; index < matrix.length; index += 1) {
      const row = matrix[index] ?? [];

      if (this.isMatrixRowEmpty(row)) {
        continue;
      }

      const data: ParsedRow = {};

      for (const header of baseHeaders) {
        data[header.key] = row[header.columnIndex] ?? '';
      }

      rows.push({
        rowNumber: index + 1,
        data,
      });
    }

    const headers = baseHeaders.map((header) => ({
      ...header,
      sampleValues: rows
        .map((row) => this.toDisplayString(row.data[header.key]))
        .filter(Boolean)
        .slice(0, 5),
    }));

    return {
      sheets: workbook.sheets,
      selectedSheetName,
      detectedHeaderRow,
      headerRow,
      dataStartRow,
      headers,
      rows,
    };
  }

  private readWorkbook(file: ImportCommand['file']) {
    const lowerName = file.filename.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const csvText = file.buffer.toString('utf8');
      const delimiter = this.detectCsvDelimiter(csvText);
      const matrix = parseCsv(csvText, {
        bom: true,
        columns: false,
        delimiter,
        skip_empty_lines: false,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      }) as unknown[][];

      return {
        sheets: ['CSV'],
        matrices: new Map<string, unknown[][]>([['CSV', matrix]]),
      };
    }

    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: true,
      });

      const matrices = new Map<string, unknown[][]>();

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];

        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: '',
          raw: false,
          blankrows: true,
        });

        matrices.set(sheetName, matrix);
      }

      return {
        sheets: workbook.SheetNames,
        matrices,
      };
    }

    throw new BadRequestException('Unsupported import file');
  }

  private detectCsvDelimiter(csvText: string) {
    const sampleLine = csvText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? '';

    const candidates = [',', ';', '\t'];

    return candidates.reduce((best, candidate) => {
      const candidateCount = sampleLine.split(candidate).length - 1;
      const bestCount = sampleLine.split(best).length - 1;

      return candidateCount > bestCount ? candidate : best;
    }, ',');
  }

  private detectHeaderRow(matrix: unknown[][]) {
    const aliases = this.getAllKnownHeaderAliases();
    let bestRow = 1;
    let bestScore = Number.NEGATIVE_INFINITY;

    const scanCount = Math.min(matrix.length, HEADER_SCAN_LIMIT);

    for (let index = 0; index < scanCount; index += 1) {
      const row = matrix[index] ?? [];
      const values = row
        .map((value) => this.toDisplayString(value))
        .filter(Boolean);

      if (values.length === 0) {
        continue;
      }

      const normalizedValues = values.map((value) =>
        this.normalizeHeader(value),
      );

      const knownMatches = normalizedValues.filter((value) =>
        aliases.has(value),
      ).length;

      const distinctValues = new Set(normalizedValues).size;
      let score = knownMatches * 25 + values.length * 2 + distinctValues;

      if (values.length === 1) {
        score -= 20;
      }

      if (values.some((value) => value.length > 80)) {
        score -= 8;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRow = index + 1;
      }
    }

    return bestRow;
  }

  private buildHeaders(values: unknown[], columnCount: number) {
    const usedKeys = new Map<string, number>();
    const headers: Omit<ImportHeader, 'sampleValues'>[] = [];

    for (let index = 0; index < columnCount; index += 1) {
      const columnLetter = XLSX.utils.encode_col(index);
      const rawLabel = this.toDisplayString(values[index]);
      const label = rawLabel || `Column ${columnLetter}`;
      const count = (usedKeys.get(label) ?? 0) + 1;

      usedKeys.set(label, count);

      headers.push({
        key: count === 1 ? label : `${label}__${count}`,
        label,
        columnIndex: index,
        columnLetter,
      });
    }

    return headers;
  }

  private suggestMapping(
    headers: ImportHeader[],
    rows: ParsedImportRow[],
    registrationFields: RegistrationField[],
  ): ImportMapping {
    const usedHeaders = new Set<string>();

    const pick = (aliases: string[]) => {
      const found = this.findHeaderFromHeaders(headers, aliases, usedHeaders);

      if (found) {
        usedHeaders.add(found);
      }

      return found;
    };

    const mapping: ImportMapping = {
      fullName: pick([
        'full_name',
        'full name',
        'name',
        'visitor name',
        'attendee name',
        'الاسم',
        'الاسم الكامل',
        'اسم الزائر',
      ]),
      phone: pick([
        'phone',
        'mobile',
        'whatsapp',
        'phone number',
        'رقم الهاتف',
        'الهاتف',
        'الموبايل',
      ]),
      email: pick([
        'email',
        'mail',
        'email address',
        'البريد الإلكتروني',
        'البريد الالكتروني',
      ]),
      companyName: pick([
        'company',
        'company_name',
        'company name',
        'organization',
        'اسم الشركة',
        'الشركة',
        'الجهة',
      ]),
      jobTitle: pick([
        'job_title',
        'job title',
        'position',
        'title',
        'occupation',
        'المسمى الوظيفي',
        'المنصب',
        'الوظيفة',
      ]),
      externalId: pick([
        'external_id',
        'external id',
        'registration id',
        'serial',
        'serial number',
        'رقم تسلسلي',
        'المعرف الخارجي',
      ]),
      notes: pick(['notes', 'note', 'remarks', 'ملاحظات', 'ملاحظة']),
      attendeeTypeCode: pick([
        'attendee_type_code',
        'attendee type code',
        'type code',
        'كود نوع الحضور',
      ]),
      customFields: {},
    };

    if (!mapping.externalId) {
      const sequentialHeader = this.findSequentialIdentifierHeader(
        headers,
        rows,
        usedHeaders,
      );

      if (sequentialHeader) {
        mapping.externalId = sequentialHeader;
        usedHeaders.add(sequentialHeader);
      }
    }

    for (const field of registrationFields) {
      const header = this.findHeaderFromHeaders(
        headers,
        [field.key, field.labelAr, field.labelEn ?? ''],
        usedHeaders,
      );

      if (header) {
        mapping.customFields![field.key] = header;
        usedHeaders.add(header);
      }
    }

    return this.normalizeMapping(mapping);
  }

  private buildPreviewWarnings(input: {
    parsed: ParsedImportFile;
    suggestedMapping: ImportMapping;
    registrationFields: RegistrationField[];
    attendeeTypeId?: string;
  }) {
    const warnings: PreviewWarning[] = [];

    if (input.parsed.rows.length === 0) {
      warnings.push({
        code: 'NO_DATA_ROWS',
        severity: 'ERROR',
        message: 'لم يتم العثور على صفوف بيانات بعد صف العناوين المحدد.',
      });
    }

    if (!input.suggestedMapping.fullName) {
      warnings.push({
        code: 'FULL_NAME_NOT_DETECTED',
        severity: 'ERROR',
        message: 'لم يتم اكتشاف عمود الاسم الكامل تلقائيًا ويجب ربطه يدويًا.',
      });
    }

    if (!input.suggestedMapping.phone) {
      warnings.push({
        code: 'PHONE_NOT_DETECTED',
        severity: 'INFO',
        message:
          'لا يوجد عمود هاتف واضح. الاستيراد سيعمل لأن الهاتف اختياري في مسار Excel فقط.',
      });
    }

    const applicableFields = input.registrationFields.filter(
      (field) =>
        field.attendeeTypeId === null ||
        !input.attendeeTypeId ||
        field.attendeeTypeId === input.attendeeTypeId,
    );

    for (const field of applicableFields) {
      if (
        field.isRequired &&
        !input.suggestedMapping.customFields?.[field.key]
      ) {
        warnings.push({
          code: 'REQUIRED_CUSTOM_FIELD_UNMAPPED',
          severity: 'WARNING',
          message: `الحقل الإلزامي «${field.labelAr}» لم يُربط تلقائيًا بعمود من الملف.`,
        });
      }
    }

    const duplicateLabels = input.parsed.headers.filter((header) =>
      /__\d+$/.test(header.key),
    );

    if (duplicateLabels.length > 0) {
      warnings.push({
        code: 'DUPLICATE_HEADERS_RENAMED',
        severity: 'WARNING',
        message:
          'يوجد أكثر من عمود يحمل الاسم نفسه، وتم تمييز الأعمدة المكررة تلقائيًا.',
      });
    }

    const suspiciousRows = this.findPotentialNameJobSwaps(
      input.parsed.rows,
      input.suggestedMapping,
    );

    if (suspiciousRows.length > 0) {
      warnings.push({
        code: 'POSSIBLE_NAME_JOB_SWAP',
        severity: 'WARNING',
        message:
          'توجد صفوف يُحتمل أن يكون فيها الاسم والمسمى الوظيفي معكوسين. راجعها قبل بدء الاستيراد.',
        rowNumbers: suspiciousRows.slice(0, 50),
      });
    }

    const duplicateWarnings = this.findDuplicateIdentifiersInFile(
      input.parsed.rows,
      input.suggestedMapping,
    );

    warnings.push(...duplicateWarnings);

    return warnings;
  }

  private findPotentialNameJobSwaps(
    rows: ParsedImportRow[],
    mapping: ImportMapping,
  ) {
    if (!mapping.fullName || !mapping.jobTitle) {
      return [];
    }

    const jobHints = [
      'manager',
      'director',
      'engineer',
      'doctor',
      'sales',
      'marketing',
      'owner',
      'ceo',
      'مدير',
      'مهندس',
      'دكتور',
      'طبيب',
      'مبيعات',
      'تسويق',
      'محاسب',
      'مسؤول',
      'منسق',
      'رئيس',
      'موظف',
    ];

    return rows
      .filter((row) => {
        const name = this.toDisplayString(row.data[mapping.fullName!]);
        const jobTitle = this.toDisplayString(row.data[mapping.jobTitle!]);

        if (!name || !jobTitle) {
          return false;
        }

        const normalizedName = name.toLowerCase();
        const normalizedJob = jobTitle.toLowerCase();
        const nameLooksLikeJob = jobHints.some((hint) =>
          normalizedName.includes(hint),
        );
        const jobLooksLikeJob = jobHints.some((hint) =>
          normalizedJob.includes(hint),
        );
        const jobWordCount = jobTitle.split(/\s+/).filter(Boolean).length;

        return nameLooksLikeJob && !jobLooksLikeJob && jobWordCount >= 2;
      })
      .map((row) => row.rowNumber);
  }

  private findDuplicateIdentifiersInFile(
    rows: ParsedImportRow[],
    mapping: ImportMapping,
  ): PreviewWarning[] {
    const warnings: PreviewWarning[] = [];

    const fields: Array<{
      key: keyof Pick<ImportMapping, 'phone' | 'email' | 'externalId'>;
      label: string;
    }> = [
      { key: 'phone', label: 'الهاتف' },
      { key: 'email', label: 'البريد الإلكتروني' },
      { key: 'externalId', label: 'المعرف الخارجي' },
    ];

    for (const field of fields) {
      const header = mapping[field.key];

      if (!header) {
        continue;
      }

      const seen = new Map<string, number>();
      const duplicateRows = new Set<number>();

      for (const row of rows) {
        const value = this.toDisplayString(row.data[header]);

        if (!value) {
          continue;
        }

        const normalized = value.trim().toLowerCase();
        const firstRow = seen.get(normalized);

        if (firstRow) {
          duplicateRows.add(firstRow);
          duplicateRows.add(row.rowNumber);
        } else {
          seen.set(normalized, row.rowNumber);
        }
      }

      if (duplicateRows.size > 0) {
        warnings.push({
          code: `DUPLICATE_${String(field.key).toUpperCase()}`,
          severity: 'WARNING',
          message: `يوجد تكرار داخل الملف في حقل ${field.label}.`,
          rowNumbers: Array.from(duplicateRows).slice(0, 50),
        });
      }
    }

    return warnings;
  }

  private validateMapping(input: {
    mapping: ImportMapping;
    headers: ImportHeader[];
    registrationFields: RegistrationField[];
    attendeeTypeId?: string;
  }) {
    if (!input.mapping.fullName) {
      throw new BadRequestException('mapping.fullName is required');
    }

    if (!input.attendeeTypeId && !input.mapping.attendeeTypeCode) {
      throw new BadRequestException(
        'attendeeTypeId or mapping.attendeeTypeCode is required',
      );
    }

    const headerKeys = new Set(input.headers.map((header) => header.key));
    const mappedHeaders = [
      input.mapping.fullName,
      input.mapping.phone,
      input.mapping.email,
      input.mapping.companyName,
      input.mapping.jobTitle,
      input.mapping.externalId,
      input.mapping.notes,
      input.mapping.attendeeTypeCode,
      ...Object.values(input.mapping.customFields ?? {}),
    ].filter((value): value is string => Boolean(value));

    for (const header of mappedHeaders) {
      if (!headerKeys.has(header)) {
        throw new BadRequestException(
          `Mapped column was not found in the file: ${header}`,
        );
      }
    }

    if (input.attendeeTypeId) {
      for (const field of input.registrationFields) {
        if (
          field.isRequired &&
          !input.mapping.customFields?.[field.key]
        ) {
          throw new BadRequestException(
            `Required custom field mapping is missing: ${field.key}`,
          );
        }
      }
    }

    const fieldKeys = new Set(input.registrationFields.map((field) => field.key));

    for (const fieldKey of Object.keys(input.mapping.customFields ?? {})) {
      if (!fieldKeys.has(fieldKey)) {
        throw new BadRequestException(`Unknown custom field: ${fieldKey}`);
      }
    }
  }

  private normalizeMapping(mapping: ImportMapping): ImportMapping {
    const normalizeValue = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;

    const customFields = Object.fromEntries(
      Object.entries(mapping.customFields ?? {})
        .map(([key, value]) => [key.trim(), normalizeValue(value)])
        .filter(
          (entry): entry is [string, string] =>
            Boolean(entry[0]) && Boolean(entry[1]),
        ),
    );

    return {
      fullName: normalizeValue(mapping.fullName),
      phone: normalizeValue(mapping.phone),
      email: normalizeValue(mapping.email),
      companyName: normalizeValue(mapping.companyName),
      jobTitle: normalizeValue(mapping.jobTitle),
      externalId: normalizeValue(mapping.externalId),
      notes: normalizeValue(mapping.notes),
      attendeeTypeCode: normalizeValue(mapping.attendeeTypeCode),
      customFields,
    };
  }

  private findHeaderFromHeaders(
    headers: ImportHeader[],
    aliases: string[],
    usedHeaders?: Set<string>,
  ) {
    const normalizedAliases = new Set(
      aliases
        .filter(Boolean)
        .map((alias) => this.normalizeHeader(alias)),
    );

    const exact = headers.find(
      (header) =>
        !usedHeaders?.has(header.key) &&
        normalizedAliases.has(this.normalizeHeader(header.label)),
    );

    if (exact) {
      return exact.key;
    }

    return headers.find((header) => {
      if (usedHeaders?.has(header.key)) {
        return false;
      }

      const normalized = this.normalizeHeader(header.label);

      return Array.from(normalizedAliases).some(
        (alias) =>
          normalized.includes(alias) ||
          (alias.length >= 4 && alias.includes(normalized)),
      );
    })?.key;
  }

  private findSequentialIdentifierHeader(
    headers: ImportHeader[],
    rows: ParsedImportRow[],
    usedHeaders: Set<string>,
  ) {
    let bestHeader: string | undefined;
    let bestScore = 0;

    for (const header of headers) {
      if (usedHeaders.has(header.key)) {
        continue;
      }

      const values = rows
        .slice(0, 100)
        .map((row) => this.toDisplayString(row.data[header.key]))
        .filter(Boolean);

      if (values.length < Math.min(5, rows.length)) {
        continue;
      }

      const numbers = values.map((value) => Number(value));
      const numericCount = numbers.filter(Number.isFinite).length;
      const uniqueCount = new Set(values).size;
      const score = numericCount / values.length + uniqueCount / values.length;

      if (score > 1.8 && score > bestScore) {
        bestScore = score;
        bestHeader = header.key;
      }
    }

    return bestHeader;
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

    return this.isBlank(value) ? undefined : this.toDisplayString(value).trim();
  }

  private findHeader(rawData: ParsedRow, candidates: string[]) {
    const headers = Object.keys(rawData);
    const normalizedCandidates = new Set(
      candidates
        .filter(Boolean)
        .map((candidate) => this.normalizeHeader(candidate)),
    );

    return headers.find((header) =>
      normalizedCandidates.has(this.normalizeHeader(header)),
    );
  }

  private normalizeHeader(header: string) {
    return header
      .trim()
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '');
  }

  private getAllKnownHeaderAliases() {
    return new Set(
      [
        'full_name',
        'full name',
        'name',
        'visitor name',
        'الاسم',
        'الاسم الكامل',
        'اسم الزائر',
        'phone',
        'mobile',
        'whatsapp',
        'رقم الهاتف',
        'الهاتف',
        'email',
        'mail',
        'البريد الإلكتروني',
        'company',
        'company name',
        'اسم الشركة',
        'job title',
        'position',
        'المسمى الوظيفي',
        'external id',
        'serial',
        'رقم تسلسلي',
        'attendee type',
        'نوع الحضور',
        'notes',
        'ملاحظات',
      ].map((value) => this.normalizeHeader(value)),
    );
  }

  private normalizeCustomFieldValue(
    field: RegistrationField,
    value: unknown,
  ): unknown {
    if (field.type === RegistrationFieldType.NUMBER) {
      const normalized = Number(
        this.toDisplayString(value).replace(/,/g, '').trim(),
      );

      return Number.isFinite(normalized) ? normalized : value;
    }

    if (field.type === RegistrationFieldType.BOOLEAN) {
      const normalized = this.normalizeHeader(this.toDisplayString(value));

      if (['true', '1', 'yes', 'y', 'نعم'].includes(normalized)) {
        return true;
      }

      if (['false', '0', 'no', 'n', 'لا'].includes(normalized)) {
        return false;
      }

      return value;
    }

    if (field.type === RegistrationFieldType.MULTI_SELECT) {
      if (Array.isArray(value)) {
        return value;
      }

      return this.toDisplayString(value)
        .split(/[,;|،]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (field.type === RegistrationFieldType.DATE && value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === 'string' ? value.trim() : value;
  }

  private async findRegistrationFieldsForImport(
    eventId: string,
    attendeeTypeId?: string,
  ) {
    return this.prisma.registrationField.findMany({
      where: {
        eventId,
        isActive: true,
        ...(attendeeTypeId
          ? {
              OR: [{ attendeeTypeId: null }, { attendeeTypeId }],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
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

    return event;
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

    if (!attendeeType.isActive) {
      throw new BadRequestException('Attendee type must be active');
    }

    return attendeeType;
  }

  private getJobStatus(input: {
    successRows: number;
    failedRows: number;
    duplicateRows: number;
    skippedRows: number;
    pendingRows: number;
  }) {
    if (input.pendingRows > 0) {
      return ImportJobStatus.PROCESSING;
    }

    if (input.failedRows === 0) {
      return ImportJobStatus.COMPLETED;
    }

    if (
      input.successRows === 0 &&
      input.duplicateRows === 0 &&
      input.skippedRows === 0
    ) {
      return ImportJobStatus.FAILED;
    }

    return ImportJobStatus.PARTIAL_FAILED;
  }

  private parseDuplicateStrategy(value: unknown): ImportDuplicateStrategy {
    if (
      value === 'FAIL' ||
      value === 'UPDATE_EXISTING' ||
      value === 'SKIP'
    ) {
      return value;
    }

    return 'SKIP';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private isMatrixRowEmpty(row: unknown[]) {
    return row.every((value) => this.isBlank(value));
  }

  private isBlank(value: unknown) {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    );
  }

  private toDisplayString(value: unknown) {
    if (value === undefined || value === null) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value).trim();
  }

  private getExceptionMessage(error: unknown) {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      const response = error.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (
        response &&
        typeof response === 'object' &&
        'message' in response
      ) {
        const message = (response as { message?: unknown }).message;

        if (Array.isArray(message)) {
          return message.map(String).join(', ');
        }

        if (typeof message === 'string') {
          return message;
        }
      }
    }

    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }

    return 'Row processing failed';
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

  private readonly importJobInclude = {
    event: {
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        status: true,
      },
    },
    attendeeType: {
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
      },
    },
  } satisfies Prisma.ImportJobInclude;
}
