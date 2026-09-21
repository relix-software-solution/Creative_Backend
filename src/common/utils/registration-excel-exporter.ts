import { PayloadTooLargeException } from '@nestjs/common';
import {
  MovementResult,
  MovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { sanitizeSpreadsheetCell } from './spreadsheet-cell.util';
import { createStyledXlsxBuffer } from './styled-xlsx.util';

const EXPORT_MAX_ROWS = 10_000;
const EXPORT_BATCH_SIZE = 1_000;

const registrationExportSelect =
  Prisma.validator<Prisma.RegistrationSelect>()({
    id: true,
    publicId: true,

    fullName: true,
    phone: true,
    email: true,
    companyName: true,
    jobTitle: true,
    customFields: true,

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
  select: typeof registrationExportSelect;
}>;

type ExportDynamicColumn = {
  key: string;
  label: string;
};

type ExportAttendanceStatus = 'NOT_CHECKED_IN' | 'INSIDE' | 'EXITED';

type ExportAttendanceInfo = {
  status: ExportAttendanceStatus;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  lastExitAt: Date | null;
};

export type RegistrationExcelExportInput = {
  where: Prisma.RegistrationWhereInput;
  orderBy: Prisma.RegistrationOrderByWithRelationInput[];
  attendeeTypeId?: string;
};

export type RegistrationExcelExportOutput = {
  buffer: Buffer;
  rowCount: number;
};

export class RegistrationExcelExporter {
  constructor(private readonly prisma: PrismaService) {}

  async export(
    input: RegistrationExcelExportInput,
  ): Promise<RegistrationExcelExportOutput | null> {
    const total = await this.prisma.registration.count({
      where: input.where,
    });

    if (total === 0) {
      return null;
    }

    if (total > EXPORT_MAX_ROWS) {
      throw new PayloadTooLargeException(
        `Export is limited to ${EXPORT_MAX_ROWS} registrations`,
      );
    }

    const dynamicColumns = await this.getDynamicColumns(
      input.where,
      input.attendeeTypeId,
    );

    const sheetRows: unknown[][] = [this.getHeaders(dynamicColumns)];
    let offset = 0;

    while (offset < total) {
      const take = Math.min(EXPORT_BATCH_SIZE, total - offset);

      const registrations = await this.prisma.registration.findMany({
        where: input.where,
        orderBy: input.orderBy,
        skip: offset,
        take,
        select: registrationExportSelect,
      });

      if (registrations.length === 0) {
        break;
      }

      const attendanceMap = await this.getAttendanceMap(registrations);

      for (const registration of registrations) {
        const attendance =
          attendanceMap.get(registration.id) ?? this.createEmptyAttendance();

        sheetRows.push(
          this.buildSheetRow(registration, attendance, dynamicColumns),
        );
      }

      offset += registrations.length;
    }

    return {
      buffer: this.createWorkbookBuffer(sheetRows, dynamicColumns),
      rowCount: sheetRows.length - 1,
    };
  }

  private async getAttendanceMap(
    registrations: ExportRegistration[],
  ): Promise<Map<string, ExportAttendanceInfo>> {
    const result = new Map<string, ExportAttendanceInfo>();
    const registrationIds = registrations.map((registration) => registration.id);

    if (registrationIds.length === 0) {
      return result;
    }

    const movementGroups = await this.prisma.movementLog.groupBy({
      by: ['registrationId', 'type'],
      where: {
        registrationId: {
          in: registrationIds,
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
      const current =
        result.get(group.registrationId) ?? this.createEmptyAttendance();

      if (group.type === MovementType.ENTRY) {
        current.firstEntryAt = group._min.occurredAt;
        current.lastEntryAt = group._max.occurredAt;
      }

      if (group.type === MovementType.EXIT) {
        current.lastExitAt = group._max.occurredAt;
      }

      current.status = this.resolveAttendanceStatus(current);
      result.set(group.registrationId, current);
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

  private async getDynamicColumns(
    registrationWhere: Prisma.RegistrationWhereInput,
    attendeeTypeId?: string,
  ): Promise<ExportDynamicColumn[]> {
    const eventRows = await this.prisma.registration.findMany({
      where: registrationWhere,
      select: { eventId: true },
      distinct: ['eventId'],
    });

    const eventIds = eventRows.map((row) => row.eventId);

    if (eventIds.length === 0) {
      return [];
    }

    const fields = await this.prisma.registrationField.findMany({
      where: {
        eventId: { in: eventIds },
        isActive: true,
        ...(attendeeTypeId
          ? {
              OR: [{ attendeeTypeId: null }, { attendeeTypeId }],
            }
          : {}),
      },
      orderBy: [
        { eventId: 'asc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        key: true,
        labelAr: true,
        labelEn: true,
      },
    });

    const columns = new Map<string, ExportDynamicColumn>();

    for (const field of fields) {
      if (this.isBaseFieldKey(field.key) || columns.has(field.key)) {
        continue;
      }

      columns.set(field.key, {
        key: field.key,
        label: field.labelAr || field.labelEn || field.key,
      });
    }

    return [...columns.values()];
  }

  private getHeaders(dynamicColumns: ExportDynamicColumn[]): string[] {
    return [
      'رقم التسجيل',
      'الاسم الكامل',
      'رقم الهاتف',
      ...dynamicColumns.map((column) => column.label),
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
    dynamicColumns: ExportDynamicColumn[],
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

    const dynamicValues = dynamicColumns.map((column) =>
      this.safeDynamicValue(
        this.getDynamicFieldValue(registration, column.key),
      ),
    );

    return [
      this.safe(registration.publicId),
      this.safe(registration.fullName),
      this.safePhone(registration.phone),
      ...dynamicValues,
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

  private normalizeFieldKey(key: string): string {
    return key.replace(/[\s_-]/g, '').toLowerCase();
  }

  private isBaseFieldKey(key: string): boolean {
    const normalizedKey = this.normalizeFieldKey(key);

    return normalizedKey === 'fullname' || normalizedKey === 'phone';
  }

  private getEquivalentNormalizedKeys(key: string): Set<string> {
    const normalizedKey = this.normalizeFieldKey(key);

    if (normalizedKey === 'company' || normalizedKey === 'companyname') {
      return new Set(['company', 'companyname']);
    }

    if (normalizedKey === 'jobtitle' || normalizedKey === 'position') {
      return new Set(['jobtitle', 'position']);
    }

    return new Set([normalizedKey]);
  }

  private getDynamicFieldValue(
    registration: ExportRegistration,
    fieldKey: string,
  ): unknown {
    const customFields = this.toRecord(registration.customFields);
    const exactValue = customFields[fieldKey];

    if (this.hasValue(exactValue)) {
      return exactValue;
    }

    const normalizedFieldKey = this.normalizeFieldKey(fieldKey);
    const equivalentKeys = this.getEquivalentNormalizedKeys(fieldKey);
    const matchingCustomKey = Object.keys(customFields).find((key) =>
      equivalentKeys.has(this.normalizeFieldKey(key)),
    );

    if (matchingCustomKey) {
      const value = customFields[matchingCustomKey];

      if (this.hasValue(value)) {
        return value;
      }
    }

    if (normalizedFieldKey === 'email') {
      return registration.email;
    }

    if (
      normalizedFieldKey === 'company' ||
      normalizedFieldKey === 'companyname'
    ) {
      return registration.companyName;
    }

    if (normalizedFieldKey === 'jobtitle' || normalizedFieldKey === 'position') {
      return registration.jobTitle;
    }

    return undefined;
  }

  private toRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private hasValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
  }

  private safeDynamicValue(value: unknown): string {
    if (!this.hasValue(value)) {
      return '';
    }

    if (typeof value === 'boolean') {
      return this.safe(value ? 'نعم' : 'لا');
    }

    if (Array.isArray(value)) {
      return this.safe(value.map(String).join(', '));
    }

    if (typeof value === 'object') {
      return this.safe(JSON.stringify(value));
    }

    return this.safe(String(value));
  }

  /** Preserve +country codes and leading zeroes in a real XLSX text cell. */
  private safePhone(value: string | null | undefined): string {
    return value ?? '';
  }

  private safe(value: string | null | undefined): string {
    return sanitizeSpreadsheetCell(value);
  }

  private createWorkbookBuffer(
    rows: unknown[][],
    dynamicColumns: ExportDynamicColumn[],
  ): Buffer {
    return createStyledXlsxBuffer({
      rows,
      columns: [
        { wch: 22 },
        { wch: 28 },
        { wch: 20 },
        ...dynamicColumns.map(() => ({ wch: 24 })),
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
      ],
      sheetName: 'Registrations',
    });
  }
}
