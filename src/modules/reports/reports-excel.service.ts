import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  MovementResult,
  MovementType,
  Prisma,
} from '@prisma/client';
import * as XLSX from 'xlsx-js-style';
import { sanitizeSpreadsheetCell } from '../../common/utils/spreadsheet-cell.util';
import { PrismaService } from '../../database/prisma.service';
import { AdminSettingsService } from '../admin-settings/admin-settings.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ReportExportQueryDto } from './dto/report-export-query.dto';
import { ReportsService } from './reports.service';

type StyledCell = XLSX.CellObject & { s?: Record<string, unknown> };

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'E3E3E8' } },
  bottom: { style: 'thin', color: { rgb: 'E3E3E8' } },
  left: { style: 'thin', color: { rgb: 'E3E3E8' } },
  right: { style: 'thin', color: { rgb: 'E3E3E8' } },
};

const HEADER_STYLE = {
  font: { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { patternType: 'solid', fgColor: { rgb: 'A88042' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: THIN_BORDER,
};

const DATA_STYLE = {
  font: { name: 'Arial', color: { rgb: '252525' }, sz: 10 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: THIN_BORDER,
};

const ALT_STYLE = {
  ...DATA_STYLE,
  fill: { patternType: 'solid', fgColor: { rgb: 'F8F8FF' } },
};

@Injectable()
export class ReportsExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly adminSettingsService: AdminSettingsService,
  ) {}

  async exportEventReport(
    user: AuthUser,
    eventId: string,
    query: ReportExportQueryDto,
  ) {
    const event = await this.reportsService.getReportEvent(user, eventId);
    const settings = await this.adminSettingsService.getSettings();
    const range = this.resolveRange(query, event.startsAt, event.endsAt);
    const maxRows = settings.reportExportMaxRows;

    const registrationWhere: Prisma.RegistrationWhereInput = {
      eventId,
      registeredAt: { gte: range.from, lte: range.to },
    };
    const movementWhere: Prisma.MovementLogWhereInput = {
      eventId,
      occurredAt: { gte: range.from, lte: range.to },
    };

    const [registrationCount, movementCount] = await Promise.all([
      this.prisma.registration.count({ where: registrationWhere }),
      this.prisma.movementLog.count({ where: movementWhere }),
    ]);

    if (registrationCount > maxRows) {
      throw new PayloadTooLargeException(
        `Report registration export is limited to ${maxRows} rows. Narrow the date range.`,
      );
    }
    if (movementCount > maxRows) {
      throw new PayloadTooLargeException(
        `Report movement export is limited to ${maxRows} rows. Narrow the date range.`,
      );
    }

    const [registrations, movements, registrationFields] = await Promise.all([
      this.prisma.registration.findMany({
        where: registrationWhere,
        orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
        include: {
          attendeeType: {
            select: { code: true, nameAr: true, nameEn: true },
          },
        },
      }),
      this.prisma.movementLog.findMany({
        where: movementWhere,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        include: {
          registration: {
            select: {
              publicId: true,
              fullName: true,
              phone: true,
            },
          },
          checkpoint: {
            select: { code: true, nameAr: true, nameEn: true },
          },
          staffSession: {
            select: {
              staffUser: { select: { fullName: true } },
            },
          },
          device: {
            select: { code: true, name: true },
          },
        },
      }),
      this.prisma.registrationField.findMany({
        where: { eventId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { key: true, labelAr: true, labelEn: true },
      }),
    ]);

    const dynamicColumns = Array.from(
      new Map(
        registrationFields
          .filter((field) => !this.isBaseFieldKey(field.key))
          .map((field) => [
            field.key,
            {
              key: field.key,
              label: field.labelAr || field.labelEn || field.key,
            },
          ]),
      ).values(),
    );

    const overview = await this.buildFilteredOverview(
      eventId,
      range.from,
      range.to,
      registrationCount,
      movements,
    );
    const checkpointRows = await this.buildCheckpointRows(eventId, range.from, range.to);
    const staffRows = await this.buildStaffRows(eventId, range.from, range.to);

    const workbook = XLSX.utils.book_new();

    this.appendSheet(workbook, 'الملخص', [
      ['البند', 'القيمة'],
      ['الفعالية', event.titleAr || event.titleEn || event.id],
      ['من', range.from.toISOString()],
      ['إلى', range.to.toISOString()],
      ['عدد التسجيلات ضمن الفترة', overview.registrations],
      ['إجمالي الحركات ضمن الفترة', overview.movements],
      ['دخول مسموح', overview.allowedEntries],
      ['خروج مسموح', overview.allowedExits],
      ['حركات مرفوضة', overview.denied],
      ['زوار فريدون دخلوا ضمن الفترة', overview.uniqueVisitors],
      ['تاريخ إنشاء التقرير', new Date().toISOString()],
    ], [28, 34]);

    const registrationHeaders = [
      'رقم التسجيل',
      'الاسم الكامل',
      'رقم الهاتف',
      'البريد الإلكتروني',
      'الشركة',
      'المسمى الوظيفي',
      'فئة الحضور',
      'حالة التسجيل',
      'مصدر التسجيل',
      'تاريخ التسجيل UTC',
      ...dynamicColumns.map((column) => column.label),
    ];
    const registrationRows: unknown[][] = [registrationHeaders];
    for (const registration of registrations) {
      const customFields = this.toRecord(registration.customFields);
      registrationRows.push([
        this.safe(registration.publicId),
        this.safe(registration.fullName),
        registration.phone ?? '',
        this.safe(registration.email),
        this.safe(registration.companyName),
        this.safe(registration.jobTitle),
        this.safe(
          registration.attendeeType.nameAr ||
            registration.attendeeType.nameEn ||
            registration.attendeeType.code,
        ),
        registration.status,
        registration.source,
        registration.registeredAt.toISOString(),
        ...dynamicColumns.map((column) =>
          this.safeUnknown(this.findCustomValue(customFields, column.key)),
        ),
      ]);
    }
    this.appendSheet(
      workbook,
      'التسجيلات',
      registrationRows,
      registrationHeaders.map((header) =>
        header === 'الاسم الكامل' ? 28 : header === 'رقم الهاتف' ? 20 : 22,
      ),
      2,
    );

    const movementRows: unknown[][] = [[
      'الوقت UTC',
      'رقم التسجيل',
      'الزائر',
      'الهاتف',
      'الحركة',
      'النتيجة',
      'السبب',
      'نقطة الدخول',
      'الموظف',
      'الجهاز',
    ]];
    for (const movement of movements) {
      movementRows.push([
        movement.occurredAt.toISOString(),
        this.safe(movement.registration.publicId),
        this.safe(movement.registration.fullName),
        movement.registration.phone ?? '',
        movement.type,
        movement.result,
        this.safe(movement.reason),
        this.safe(
          movement.checkpoint?.nameAr ||
            movement.checkpoint?.nameEn ||
            movement.checkpoint?.code,
        ),
        this.safe(movement.staffSession?.staffUser.fullName),
        this.safe(movement.device.name || movement.device.code),
      ]);
    }
    this.appendSheet(workbook, 'الحركات', movementRows, [24, 20, 28, 20, 14, 14, 28, 24, 24, 22], 3);

    this.appendSheet(
      workbook,
      'نقاط الدخول',
      [
        ['نقطة الدخول', 'الكود', 'إجمالي الحركات', 'مسموح', 'مرفوض', 'دخول', 'خروج'],
        ...checkpointRows,
      ],
      [28, 18, 18, 16, 16, 16, 16],
    );

    this.appendSheet(
      workbook,
      'أداء الموظفين',
      [
        ['الموظف', 'إجمالي الحركات', 'مسموح', 'مرفوض'],
        ...staffRows,
      ],
      [30, 18, 16, 16],
    );

    const output = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
      compression: true,
      cellStyles: true,
    }) as Buffer | Uint8Array;

    const safeEventName = (event.titleEn || event.titleAr || event.id)
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event';

    return {
      buffer: Buffer.isBuffer(output) ? output : Buffer.from(output),
      filename: `report-${safeEventName}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      counts: { registrations: registrationCount, movements: movementCount },
    };
  }

  private resolveRange(
    query: ReportExportQueryDto,
    startsAt: Date,
    endsAt: Date,
  ) {
    const from = query.from ? new Date(query.from) : startsAt;
    const to = query.to ? new Date(query.to) : endsAt;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid report date range');
    }
    if (from > to) {
      throw new BadRequestException('Report start date must be before end date');
    }

    return { from, to };
  }

  private async buildFilteredOverview(
    eventId: string,
    from: Date,
    to: Date,
    registrationCount: number,
    movements: Array<{
      registrationId: string;
      type: MovementType;
      result: MovementResult;
    }>,
  ) {
    const allowedEntries = movements.filter(
      (item) => item.type === MovementType.ENTRY && item.result === MovementResult.ALLOWED,
    );
    const allowedExits = movements.filter(
      (item) => item.type === MovementType.EXIT && item.result === MovementResult.ALLOWED,
    );

    return {
      eventId,
      from,
      to,
      registrations: registrationCount,
      movements: movements.length,
      allowedEntries: allowedEntries.length,
      allowedExits: allowedExits.length,
      denied: movements.filter((item) => item.result === MovementResult.DENIED).length,
      uniqueVisitors: new Set(allowedEntries.map((item) => item.registrationId)).size,
    };
  }

  private async buildCheckpointRows(eventId: string, from: Date, to: Date) {
    const [checkpoints, counts] = await Promise.all([
      this.prisma.checkpoint.findMany({
        where: { eventId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, code: true, nameAr: true, nameEn: true },
      }),
      this.prisma.movementLog.groupBy({
        by: ['checkpointId', 'type', 'result'],
        where: { eventId, occurredAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ]);

    return checkpoints.map((checkpoint) => {
      const rows = counts.filter((item) => item.checkpointId === checkpoint.id);
      const sum = (predicate: (item: (typeof rows)[number]) => boolean) =>
        rows.filter(predicate).reduce((total, item) => total + item._count._all, 0);

      return [
        this.safe(checkpoint.nameAr || checkpoint.nameEn || checkpoint.code),
        this.safe(checkpoint.code),
        rows.reduce((total, item) => total + item._count._all, 0),
        sum((item) => item.result === MovementResult.ALLOWED),
        sum((item) => item.result === MovementResult.DENIED),
        sum((item) => item.type === MovementType.ENTRY),
        sum((item) => item.type === MovementType.EXIT),
      ];
    });
  }

  private async buildStaffRows(eventId: string, from: Date, to: Date) {
    const rows = await this.prisma.movementLog.groupBy({
      by: ['staffSessionId', 'result'],
      where: {
        eventId,
        staffSessionId: { not: null },
        occurredAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });
    const sessionIds = Array.from(
      new Set(rows.map((row) => row.staffSessionId).filter((value): value is string => Boolean(value))),
    );
    const sessions = await this.prisma.staffSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        staffUserId: true,
        staffUser: { select: { fullName: true } },
      },
    });

    const byUser = new Map<string, { name: string; total: number; allowed: number; denied: number }>();
    for (const session of sessions) {
      const current = byUser.get(session.staffUserId) ?? {
        name: session.staffUser.fullName,
        total: 0,
        allowed: 0,
        denied: 0,
      };
      const sessionCounts = rows.filter((row) => row.staffSessionId === session.id);
      for (const count of sessionCounts) {
        current.total += count._count._all;
        if (count.result === MovementResult.ALLOWED) current.allowed += count._count._all;
        if (count.result === MovementResult.DENIED) current.denied += count._count._all;
      }
      byUser.set(session.staffUserId, current);
    }

    return Array.from(byUser.values())
      .sort((a, b) => b.total - a.total)
      .map((row) => [this.safe(row.name), row.total, row.allowed, row.denied]);
  }

  private appendSheet(
    workbook: XLSX.WorkBook,
    name: string,
    rows: unknown[][],
    widths: number[],
    phoneColumnIndex?: number,
  ) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    worksheet['!rows'] = rows.map((_, index) => ({ hpt: index === 0 ? 28 : 24 }));

    if (worksheet['!ref']) {
      worksheet['!autofilter'] = { ref: worksheet['!ref'] };
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const style = row === 0 ? HEADER_STYLE : row % 2 === 0 ? ALT_STYLE : DATA_STYLE;
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          const cell = worksheet[address] as StyledCell | undefined;
          if (!cell) continue;
          if (typeof cell.v === 'string') {
            cell.t = 's';
            delete cell.f;
          }
          cell.s = row > 0 && phoneColumnIndex === column
            ? { ...style, numFmt: '@' }
            : style;
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  private normalizeFieldKey(key: string) {
    return key.replace(/[\s_-]/g, '').toLowerCase();
  }

  private isBaseFieldKey(key: string) {
    const normalized = this.normalizeFieldKey(key);
    return ['fullname', 'phone', 'email', 'company', 'companyname', 'jobtitle', 'position'].includes(normalized);
  }

  private findCustomValue(record: Record<string, unknown>, key: string) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
    const normalized = this.normalizeFieldKey(key);
    const match = Object.keys(record).find((candidate) => this.normalizeFieldKey(candidate) === normalized);
    return match ? record[match] : undefined;
  }

  private toRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private safeUnknown(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
    if (Array.isArray(value)) return this.safe(value.map(String).join(', '));
    if (typeof value === 'object') return this.safe(JSON.stringify(value));
    return this.safe(String(value));
  }

  private safe(value: string | null | undefined) {
    return sanitizeSpreadsheetCell(value);
  }
}
