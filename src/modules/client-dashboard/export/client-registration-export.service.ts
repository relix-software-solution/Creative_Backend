import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  AuditAction,
  MovementResult,
  MovementType,
  Prisma,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.type';
import { ClientDashboardQueryService } from '../client-dashboard-query.service';
import { ClientRegistrationsQueryDto } from '../dto/client-registrations-query.dto';
import { sanitizeSpreadsheetCell } from './spreadsheet-cell.util';

const EXPORT_MAX_ROWS = 10_000;
const EXPORT_BATCH_SIZE = 1_000;

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const clientRegistrationExportSelect =
  Prisma.validator<Prisma.RegistrationSelect>()({
    publicId: true,

    fullName: true,
    phone: true,
    email: true,
    companyName: true,
    jobTitle: true,

    status: true,
    source: true,
    registeredAt: true,

    event: {
      select: {
        titleAr: true,
        titleEn: true,
        type: true,

        venues: {
          select: {
            country: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    },

    attendeeType: {
      select: {
        code: true,
        nameAr: true,
        nameEn: true,
      },
    },
  });

type ExportRegistration = Prisma.RegistrationGetPayload<{
  select: typeof clientRegistrationExportSelect;
}>;

type ExportAttendanceStatus = 'NOT_CHECKED_IN' | 'INSIDE' | 'EXITED';

type ExportAttendanceInfo = {
  status: ExportAttendanceStatus;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  lastExitAt: Date | null;
};

export type ClientRegistrationExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: typeof XLSX_CONTENT_TYPE;
  rowCount: number;
};

export type ClientRegistrationExportContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class ClientRegistrationExportService {
  private readonly logger = new Logger(ClientRegistrationExportService.name);

  /**
   * حماية أولية ضمن Process واحد:
   * نفس العميل لا يستطيع تشغيل Exportين بنفس الوقت.
   *
   * عند تشغيل عدة Backend instances لاحقًا،
   * يمكن استبدالها بقفل Redis موزع.
   */
  private readonly activeClientExports = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: ClientDashboardQueryService,
  ) {}

  async exportRegistrations(
    user: AuthUser,
    query: ClientRegistrationsQueryDto,
    context: ClientRegistrationExportContext,
  ): Promise<ClientRegistrationExportResult | null> {
    const clientId = this.queryService.getClientIdOrThrow(user);

    this.queryService.validateDateRange(query.from, query.to);

    if (this.activeClientExports.has(clientId)) {
      throw new HttpException(
        'A registration export is already running',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeClientExports.add(clientId);

    const startedAt = Date.now();
    const filtersHash = this.createFiltersHash(query);

    let rowCount = 0;

    try {
      const where = this.queryService.buildRegistrationWhere(clientId, query);

      const total = await this.prisma.registration.count({
        where,
      });

      rowCount = total;

      if (total === 0) {
        await this.writeAuditLog({
          user,
          clientId,
          context,
          filtersHash,
          rowCount: 0,
          outcome: 'completed',
          durationMs: Date.now() - startedAt,
        });

        return null;
      }

      if (total > EXPORT_MAX_ROWS) {
        throw new PayloadTooLargeException(
          `Export is limited to ${EXPORT_MAX_ROWS} registrations`,
        );
      }

      const orderBy = this.queryService.buildRegistrationOrderBy(query);

      const sheetRows: unknown[][] = [this.getHeaders()];

      let offset = 0;

      while (offset < total) {
        const take = Math.min(EXPORT_BATCH_SIZE, total - offset);

        const registrations = await this.prisma.registration.findMany({
          where,
          orderBy,
          skip: offset,
          take,
          select: clientRegistrationExportSelect,
        });

        if (registrations.length === 0) {
          break;
        }

        const attendanceMap = await this.getAttendanceMap(
          clientId,
          registrations.map((registration) => registration.publicId),
          registrations,
        );

        for (const registration of registrations) {
          const attendance =
            attendanceMap.get(registration.publicId) ??
            this.createEmptyAttendance();

          sheetRows.push(this.buildSheetRow(registration, attendance));
        }

        offset += registrations.length;
      }

      rowCount = sheetRows.length - 1;

      const buffer = this.createWorkbookBuffer(sheetRows);

      const filename = this.createFilename();

      await this.writeAuditLog({
        user,
        clientId,
        context,
        filtersHash,
        rowCount,
        outcome: 'completed',
        durationMs: Date.now() - startedAt,
      });

      return {
        buffer,
        filename,
        contentType: XLSX_CONTENT_TYPE,
        rowCount,
      };
    } catch (error) {
      await this.writeAuditLog({
        user,
        clientId,
        context,
        filtersHash,
        rowCount,
        outcome: 'failed',
        durationMs: Date.now() - startedAt,
      });

      throw error;
    } finally {
      this.activeClientExports.delete(clientId);
    }
  }

  private async getAttendanceMap(
    clientId: string,
    publicIds: string[],
    registrations: ExportRegistration[],
  ): Promise<Map<string, ExportAttendanceInfo>> {
    const result = new Map<string, ExportAttendanceInfo>();

    if (publicIds.length === 0 || registrations.length === 0) {
      return result;
    }

    /*
     * نحتاج IDs الداخلية للاستعلام فقط،
     * لكنها لا تدخل إلى ملف Excel.
     */
    const internalRows = await this.prisma.registration.findMany({
      where: {
        publicId: {
          in: publicIds,
        },
        event: {
          is: {
            clientId,
          },
        },
      },
      select: {
        id: true,
        publicId: true,
      },
    });

    const publicIdByInternalId = new Map(
      internalRows.map((row) => [row.id, row.publicId]),
    );

    const internalIds = internalRows.map((row) => row.id);

    if (internalIds.length === 0) {
      return result;
    }

    const movementGroups = await this.prisma.movementLog.groupBy({
      by: ['registrationId', 'type'],

      where: {
        registrationId: {
          in: internalIds,
        },

        event: {
          is: {
            clientId,
          },
        },

        type: {
          in: [MovementType.ENTRY, MovementType.EXIT],
        },

        result: MovementResult.ALLOWED,
      },

      _min: {
        occurredAt: true,
      },

      _max: {
        occurredAt: true,
      },
    });

    for (const group of movementGroups) {
      const publicId = publicIdByInternalId.get(group.registrationId);

      if (!publicId) {
        continue;
      }

      const current = result.get(publicId) ?? this.createEmptyAttendance();

      if (group.type === MovementType.ENTRY) {
        current.firstEntryAt = group._min.occurredAt;

        current.lastEntryAt = group._max.occurredAt;
      }

      if (group.type === MovementType.EXIT) {
        current.lastExitAt = group._max.occurredAt;
      }

      current.status = this.resolveAttendanceStatus(current);

      result.set(publicId, current);
    }

    return result;
  }

  private resolveAttendanceStatus(
    attendance: ExportAttendanceInfo,
  ): ExportAttendanceStatus {
    if (!attendance.lastEntryAt) {
      return 'NOT_CHECKED_IN';
    }

    if (!attendance.lastExitAt) {
      return 'INSIDE';
    }

    if (attendance.lastEntryAt.getTime() > attendance.lastExitAt.getTime()) {
      return 'INSIDE';
    }

    return 'EXITED';
  }

  private createEmptyAttendance(): ExportAttendanceInfo {
    return {
      status: 'NOT_CHECKED_IN',
      firstEntryAt: null,
      lastEntryAt: null,
      lastExitAt: null,
    };
  }

  private getHeaders(): string[] {
    return [
      'رقم التسجيل',
      'الاسم الكامل',
      'رقم الهاتف',
      'البريد الإلكتروني',
      'الشركة',
      'المسمى الوظيفي',
      'حالة التسجيل',
      'مصدر التسجيل',
      'الفعالية',
      'نوع الفعالية',
      'فئة الحضور',
      'دولة الفعالية',
      'تاريخ التسجيل UTC',
      'حالة الحضور',
      'أول دخول UTC',
      'آخر خروج UTC',
    ];
  }

  private buildSheetRow(
    registration: ExportRegistration,
    attendance: ExportAttendanceInfo,
  ): string[] {
    const eventTitle =
      registration.event.titleAr || registration.event.titleEn || '';

    const attendeeTypeName =
      registration.attendeeType?.nameAr ||
      registration.attendeeType?.nameEn ||
      registration.attendeeType?.code ||
      '';

    const countries = Array.from(
      new Set(
        registration.event.venues
          .map((venue) => venue.country)
          .filter((country): country is string => Boolean(country)),
      ),
    ).join(', ');

    return [
      this.safe(registration.publicId),
      this.safe(registration.fullName),
      this.safe(registration.phone),
      this.safe(registration.email),
      this.safe(registration.companyName),
      this.safe(registration.jobTitle),
      this.safe(registration.status),
      this.safe(registration.source),
      this.safe(eventTitle),
      this.safe(registration.event.type),
      this.safe(attendeeTypeName),
      this.safe(countries),
      registration.registeredAt.toISOString(),
      attendance.status,
      attendance.firstEntryAt?.toISOString() ?? '',
      attendance.lastExitAt?.toISOString() ?? '',
    ];
  }

  private safe(value: string | null | undefined): string {
    return sanitizeSpreadsheetCell(value);
  }

  private createWorkbookBuffer(rows: unknown[][]): Buffer {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    worksheet['!cols'] = [
      { wch: 22 },
      { wch: 28 },
      { wch: 20 },
      { wch: 34 },
      { wch: 26 },
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 34 },
      { wch: 18 },
      { wch: 24 },
      { wch: 20 },
      { wch: 26 },
      { wch: 20 },
      { wch: 26 },
      { wch: 26 },
    ];

    if (worksheet['!ref']) {
      worksheet['!autofilter'] = {
        ref: worksheet['!ref'],
      };
    }

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Registrations');

    const output = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
      compression: true,
    }) as Buffer | Uint8Array;

    return Buffer.isBuffer(output) ? output : Buffer.from(output);
  }

  private createFilename(): string {
    const date = new Date().toISOString().slice(0, 10);

    return `client-registrations-${date}.xlsx`;
  }

  private createFiltersHash(query: ClientRegistrationsQueryDto): string {
    const normalizedFilters = {
      search: query.search ?? null,
      eventId: query.eventId ?? null,

      eventIds: query.eventIds?.slice().sort() ?? [],

      attendeeTypeId: query.attendeeTypeId ?? null,

      status: query.status ?? null,
      source: query.source ?? null,
      attendance: query.attendance ?? null,

      from: query.from ?? null,
      to: query.to ?? null,

      eventCountry: query.eventCountry ?? null,

      sortBy: query.sortBy ?? null,
      sortDirection: query.sortDirection ?? null,
    };

    return createHash('sha256')
      .update(JSON.stringify(normalizedFilters))
      .digest('hex');
  }

  private async writeAuditLog(input: {
    user: AuthUser;
    clientId: string;
    context: ClientRegistrationExportContext;
    filtersHash: string;
    rowCount: number;
    outcome: 'completed' | 'failed';
    durationMs: number;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.user.id,
          action: AuditAction.EXPORT,

          entityType: 'CLIENT_REGISTRATION_EXPORT',

          entityId: input.clientId,

          ipAddress: input.context.ipAddress,

          userAgent: input.context.userAgent,

          metadata: {
            filtersHash: input.filtersHash,

            rowCount: input.rowCount,
            format: 'xlsx',
            outcome: input.outcome,

            durationMs: input.durationMs,
          },
        },
      });
    } catch {
      /*
       * لا نفشل تحميل الملف بسبب تعطل AuditLog،
       * لكن نسجل تحذيرًا بلا PII.
       */
      this.logger.warn('Failed to write registration export audit log');
    }
  }
}
