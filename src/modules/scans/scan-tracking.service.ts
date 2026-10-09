import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MovementResult, MovementType, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx-js-style';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AdminSettingsService } from '../admin-settings/admin-settings.service';
import {
  VisitorPresenceState,
  VisitorScanTrackingQueryDto,
} from './dto/visitor-scan-tracking-query.dto';

type StyledCell = XLSX.CellObject & { s?: Record<string, unknown> };

type VisitorState = VisitorPresenceState;

type VisitorSummary = {
  registrationId: string;
  publicId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  jobTitle: string | null;
  registrationStatus: string;
  event: {
    id: string;
    titleAr: string;
    titleEn: string | null;
  };
  attendeeType: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string | null;
  };
  currentState: VisitorState;
  scanCount: number;
  allowedCount: number;
  deniedCount: number;
  warningCount: number;
  entryCount: number;
  exitCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastResult: MovementResult | null;
  lastMovementType: MovementType | null;
  lastReason: string | null;
  lastCheckpoint: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string | null;
  } | null;
};

const BORDER = {
  top: { style: 'thin', color: { rgb: 'E4E4E7' } },
  bottom: { style: 'thin', color: { rgb: 'E4E4E7' } },
  left: { style: 'thin', color: { rgb: 'E4E4E7' } },
  right: { style: 'thin', color: { rgb: 'E4E4E7' } },
};

const HEADER_STYLE = {
  font: { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { patternType: 'solid', fgColor: { rgb: 'A88042' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

const DATA_STYLE = {
  font: { name: 'Arial', color: { rgb: '252525' }, sz: 10 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

const ALT_DATA_STYLE = {
  ...DATA_STYLE,
  fill: { patternType: 'solid', fgColor: { rgb: 'F8F8FF' } },
};

@Injectable()
export class ScanTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminSettingsService: AdminSettingsService,
  ) {}

  async getFilters() {
    const events = await this.prisma.event.findMany({
      where: {
        scanEventsRaw: {
          some: { registrationId: { not: null } },
        },
      },
      orderBy: [{ startsAt: 'desc' }, { titleAr: 'asc' }],
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        status: true,
        startsAt: true,
        endsAt: true,
        _count: {
          select: {
            scanEventsRaw: {
              where: { registrationId: { not: null } },
            },
          },
        },
      },
    });

    return {
      events: events.map((event) => ({
        id: event.id,
        titleAr: event.titleAr,
        titleEn: event.titleEn,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        scanCount: event._count.scanEventsRaw,
      })),
    };
  }

  async listVisitors(query: VisitorScanTrackingQueryDto) {
    const { page, limit } = normalizePagination(query);
    const dataset = await this.buildDataset(query);
    const start = (page - 1) * limit;
    const items = dataset.summaries.slice(start, start + limit);

    return {
      items,
      summary: this.buildSummary(dataset.summaries),
      page,
      limit,
      total: dataset.summaries.length,
      totalPages: Math.max(Math.ceil(dataset.summaries.length / limit), 1),
      appliedFilters: this.formatAppliedFilters(query),
    };
  }

  async getVisitor(
    registrationId: string,
    query: VisitorScanTrackingQueryDto,
  ) {
    const range = this.resolveRange(query);
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        publicId: true,
        eventId: true,
        fullName: true,
        phone: true,
        email: true,
        companyName: true,
        jobTitle: true,
        status: true,
        source: true,
        registeredAt: true,
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
        event: {
          select: {
            id: true,
            titleAr: true,
            titleEn: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    if (query.eventId && query.eventId !== registration.eventId) {
      throw new NotFoundException('Registration does not belong to this event');
    }

    const scanWhere: Prisma.ScanEventRawWhereInput = {
      registrationId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...this.buildScanDateWhere(range),
    };

    const [scans, presenceMovements] = await Promise.all([
      this.prisma.scanEventRaw.findMany({
        where: scanWhere,
        orderBy: [{ scannedAtDevice: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          operationId: true,
          type: true,
          status: true,
          result: true,
          reason: true,
          scannedAtDevice: true,
          receivedAtServer: true,
          processedAt: true,
          checkpoint: {
            select: { id: true, code: true, nameAr: true, nameEn: true, type: true },
          },
          device: {
            select: { id: true, code: true, name: true },
          },
          staffSession: {
            select: {
              id: true,
              staffUser: {
                select: { id: true, fullName: true },
              },
            },
          },
        },
      }),
      this.prisma.movementLog.findMany({
        where: {
          registrationId,
          result: MovementResult.ALLOWED,
          type: { in: [MovementType.ENTRY, MovementType.EXIT] },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { type: true, occurredAt: true },
      }),
    ]);

    const currentState = this.resolvePresenceState(presenceMovements);
    const allowedCount = scans.filter(
      (scan) => scan.result === MovementResult.ALLOWED,
    ).length;
    const deniedCount = scans.filter(
      (scan) => scan.result === MovementResult.DENIED,
    ).length;
    const warningCount = scans.filter(
      (scan) => scan.result === MovementResult.WARNING,
    ).length;

    return {
      visitor: registration,
      summary: {
        currentState,
        scanCount: scans.length,
        allowedCount,
        deniedCount,
        warningCount,
        entryCount: scans.filter(
          (scan) =>
            scan.type === MovementType.ENTRY &&
            scan.result === MovementResult.ALLOWED,
        ).length,
        exitCount: scans.filter(
          (scan) =>
            scan.type === MovementType.EXIT &&
            scan.result === MovementResult.ALLOWED,
        ).length,
        firstSeenAt: scans.length ? scans[scans.length - 1].scannedAtDevice : null,
        lastSeenAt: scans.length ? scans[0].scannedAtDevice : null,
      },
      timeline: scans.map((scan) => ({
        ...scan,
        reason: scan.reason === 'ALLOWED' ? null : scan.reason,
      })),
      appliedFilters: this.formatAppliedFilters(query),
    };
  }

  async exportVisitors(query: VisitorScanTrackingQueryDto) {
    const [settings, dataset, selectedEvent] = await Promise.all([
      this.adminSettingsService.getSettings(),
      this.buildDataset(query),
      query.eventId
        ? this.prisma.event.findUnique({
            where: { id: query.eventId },
            select: { titleAr: true, titleEn: true },
          })
        : Promise.resolve(null),
    ]);
    const maxRows = settings.reportExportMaxRows;

    if (dataset.summaries.length > maxRows) {
      throw new PayloadTooLargeException(
        `Visitor export is limited to ${maxRows} visitors. Narrow the filters.`,
      );
    }

    if (dataset.scans.length > maxRows) {
      throw new PayloadTooLargeException(
        `Visitor scan export is limited to ${maxRows} scan rows. Narrow the filters.`,
      );
    }

    const workbook = XLSX.utils.book_new();
    const summary = this.buildSummary(dataset.summaries);

    this.appendSheet(
      workbook,
      'الملخص',
      [
        ['البند', 'القيمة'],
        ['عدد الزوار', summary.totalVisitors],
        ['داخل الفعالية الآن', summary.insideVisitors],
        ['خارج الفعالية الآن', summary.outsideVisitors],
        ['بدون حركة دخول/خروج مسموحة', summary.noAllowedMovementVisitors],
        ['إجمالي قراءات QR', summary.totalScans],
        ['القراءات المسموحة', summary.allowedScans],
        ['القراءات المرفوضة', summary.deniedScans],
        ['قراءات التحذير', summary.warningScans],
        [
          'الفعالية',
          selectedEvent?.titleAr || selectedEvent?.titleEn || 'كل الفعاليات',
        ],
        ['من', query.from ?? '—'],
        ['إلى', query.to ?? '—'],
      ],
      [34, 28],
    );

    this.appendSheet(
      workbook,
      'الزوار',
      [
        [
          'رقم التسجيل',
          'الاسم',
          'الهاتف',
          'البريد',
          'الفعالية',
          'نوع الحضور',
          'الحالة الحالية',
          'عدد القراءات',
          'مسموح',
          'مرفوض',
          'تحذير',
          'دخول مسموح',
          'خروج مسموح',
          'أول قراءة',
          'آخر قراءة',
          'آخر بوابة',
          'آخر نتيجة',
        ],
        ...dataset.summaries.map((visitor) => [
          visitor.publicId,
          visitor.fullName,
          visitor.phone ?? '',
          visitor.email ?? '',
          visitor.event.titleAr || visitor.event.titleEn || '',
          visitor.attendeeType.nameAr || visitor.attendeeType.nameEn || visitor.attendeeType.code,
          this.translateState(visitor.currentState),
          visitor.scanCount,
          visitor.allowedCount,
          visitor.deniedCount,
          visitor.warningCount,
          visitor.entryCount,
          visitor.exitCount,
          this.formatExcelDate(visitor.firstSeenAt),
          this.formatExcelDate(visitor.lastSeenAt),
          visitor.lastCheckpoint?.nameAr || visitor.lastCheckpoint?.nameEn || visitor.lastCheckpoint?.code || '',
          visitor.lastResult ?? '',
        ]),
      ],
      [20, 28, 20, 28, 28, 20, 20, 14, 12, 12, 12, 12, 12, 24, 24, 24, 16],
    );

    this.appendSheet(
      workbook,
      'المسار التفصيلي',
      [
        [
          'رقم التسجيل',
          'الاسم',
          'الهاتف',
          'الفعالية',
          'نوع الحضور',
          'وقت القراءة',
          'نوع الحركة',
          'النتيجة',
          'السبب',
          'البوابة',
          'الجهاز',
          'الموظف',
          'حالة المعالجة',
        ],
        ...dataset.scans.map((scan) => [
          scan.registration?.publicId ?? '',
          scan.registration?.fullName ?? '',
          scan.registration?.phone ?? '',
          scan.event?.titleAr || scan.event?.titleEn || '',
          scan.registration?.attendeeType?.nameAr ||
            scan.registration?.attendeeType?.nameEn ||
            scan.registration?.attendeeType?.code ||
            '',
          this.formatExcelDate(scan.scannedAtDevice),
          scan.type,
          scan.result ?? '',
          scan.reason === 'ALLOWED' ? '' : scan.reason ?? '',
          scan.checkpoint?.nameAr || scan.checkpoint?.nameEn || scan.checkpoint?.code || '',
          scan.device?.name || scan.device?.code || '',
          scan.staffSession?.staffUser?.fullName || '',
          scan.status,
        ]),
      ],
      [20, 28, 20, 28, 20, 24, 18, 16, 28, 24, 20, 24, 18],
    );

    const output = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
      compression: true,
      cellStyles: true,
    }) as Buffer | Uint8Array;

    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
    const date = new Date().toISOString().slice(0, 10);

    return {
      buffer,
      filename: `visitor-tracking-${date}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async buildDataset(query: VisitorScanTrackingQueryDto) {
    const range = this.resolveRange(query);
    const scanWhere = this.buildScanWhere(query, range);
    const registrationWhere = this.buildRegistrationWhere(query, scanWhere);

    const registrations = await this.prisma.registration.findMany({
      where: registrationWhere,
      select: {
        id: true,
        publicId: true,
        fullName: true,
        phone: true,
        email: true,
        companyName: true,
        jobTitle: true,
        status: true,
        event: {
          select: { id: true, titleAr: true, titleEn: true },
        },
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });

    if (registrations.length === 0) {
      return { summaries: [] as VisitorSummary[], scans: [] };
    }

    const registrationIds = registrations.map((registration) => registration.id);

    const [scans, presenceMovements] = await Promise.all([
      this.prisma.scanEventRaw.findMany({
        where: {
          ...scanWhere,
          registrationId: { in: registrationIds },
        },
        orderBy: [{ scannedAtDevice: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          registrationId: true,
          type: true,
          status: true,
          result: true,
          reason: true,
          scannedAtDevice: true,
          registration: {
            select: {
              id: true,
              publicId: true,
              fullName: true,
              phone: true,
              attendeeType: {
                select: { code: true, nameAr: true, nameEn: true },
              },
            },
          },
          event: {
            select: { id: true, titleAr: true, titleEn: true },
          },
          checkpoint: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
          device: {
            select: { id: true, code: true, name: true },
          },
          staffSession: {
            select: {
              id: true,
              staffUser: {
                select: { id: true, fullName: true },
              },
            },
          },
        },
      }),
      this.prisma.movementLog.findMany({
        where: {
          registrationId: { in: registrationIds },
          result: MovementResult.ALLOWED,
          type: { in: [MovementType.ENTRY, MovementType.EXIT] },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { registrationId: true, type: true, occurredAt: true },
      }),
    ]);

    const scanGroups = new Map<string, typeof scans>();
    for (const scan of scans) {
      if (!scan.registrationId) continue;
      const group = scanGroups.get(scan.registrationId) ?? [];
      group.push(scan);
      scanGroups.set(scan.registrationId, group);
    }

    const presenceGroups = new Map<string, typeof presenceMovements>();
    for (const movement of presenceMovements) {
      const group = presenceGroups.get(movement.registrationId) ?? [];
      group.push(movement);
      presenceGroups.set(movement.registrationId, group);
    }

    let summaries: VisitorSummary[] = registrations.map((registration) => {
      const visitorScans = scanGroups.get(registration.id) ?? [];
      const movements = presenceGroups.get(registration.id) ?? [];
      const lastScan = visitorScans[visitorScans.length - 1] ?? null;

      return {
        registrationId: registration.id,
        publicId: registration.publicId,
        fullName: registration.fullName,
        phone: registration.phone,
        email: registration.email,
        companyName: registration.companyName,
        jobTitle: registration.jobTitle,
        registrationStatus: registration.status,
        event: registration.event,
        attendeeType: registration.attendeeType,
        currentState: this.resolvePresenceState(movements),
        scanCount: visitorScans.length,
        allowedCount: visitorScans.filter(
          (scan) => scan.result === MovementResult.ALLOWED,
        ).length,
        deniedCount: visitorScans.filter(
          (scan) => scan.result === MovementResult.DENIED,
        ).length,
        warningCount: visitorScans.filter(
          (scan) => scan.result === MovementResult.WARNING,
        ).length,
        entryCount: visitorScans.filter(
          (scan) =>
            scan.type === MovementType.ENTRY &&
            scan.result === MovementResult.ALLOWED,
        ).length,
        exitCount: visitorScans.filter(
          (scan) =>
            scan.type === MovementType.EXIT &&
            scan.result === MovementResult.ALLOWED,
        ).length,
        firstSeenAt: visitorScans[0]?.scannedAtDevice ?? null,
        lastSeenAt: lastScan?.scannedAtDevice ?? null,
        lastResult: lastScan?.result ?? null,
        lastMovementType: lastScan?.type ?? null,
        lastReason:
          lastScan?.reason === 'ALLOWED' ? null : lastScan?.reason ?? null,
        lastCheckpoint: lastScan?.checkpoint ?? null,
      };
    });

    if (query.state) {
      summaries = summaries.filter(
        (visitor) => visitor.currentState === query.state,
      );
    }

    summaries.sort((a, b) => {
      const aTime = a.lastSeenAt?.getTime() ?? 0;
      const bTime = b.lastSeenAt?.getTime() ?? 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.fullName.localeCompare(b.fullName, 'ar');
    });

    const visibleRegistrationIds = new Set(
      summaries.map((visitor) => visitor.registrationId),
    );

    return {
      summaries,
      scans: scans.filter(
        (scan) =>
          scan.registrationId && visibleRegistrationIds.has(scan.registrationId),
      ),
    };
  }

  private buildRegistrationWhere(
    query: VisitorScanTrackingQueryDto,
    scanWhere: Prisma.ScanEventRawWhereInput,
  ): Prisma.RegistrationWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId
        ? { attendeeTypeId: query.attendeeTypeId }
        : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { publicId: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } },
              { externalId: { contains: search } },
            ],
          }
        : {}),
      scanEventsRaw: { some: scanWhere },
    };
  }

  private buildScanWhere(
    query: VisitorScanTrackingQueryDto,
    range: { from?: Date; to?: Date },
  ): Prisma.ScanEventRawWhereInput {
    return {
      registrationId: { not: null },
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...this.buildScanDateWhere(range),
    };
  }

  private buildScanDateWhere(range: { from?: Date; to?: Date }) {
    if (!range.from && !range.to) return {};

    return {
      scannedAtDevice: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    };
  }

  private resolveRange(query: VisitorScanTrackingQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before or equal to to');
    }

    return { from, to };
  }

  private resolvePresenceState(
    movements: Array<{ type: MovementType; occurredAt: Date }>,
  ): VisitorState {
    const last = movements[movements.length - 1];

    if (!last) return 'NO_ALLOWED_MOVEMENT';
    if (last.type === MovementType.ENTRY) return 'INSIDE';
    if (last.type === MovementType.EXIT) return 'OUTSIDE';

    return 'NO_ALLOWED_MOVEMENT';
  }

  private buildSummary(visitors: VisitorSummary[]) {
    return {
      totalVisitors: visitors.length,
      insideVisitors: visitors.filter(
        (visitor) => visitor.currentState === 'INSIDE',
      ).length,
      outsideVisitors: visitors.filter(
        (visitor) => visitor.currentState === 'OUTSIDE',
      ).length,
      noAllowedMovementVisitors: visitors.filter(
        (visitor) => visitor.currentState === 'NO_ALLOWED_MOVEMENT',
      ).length,
      totalScans: visitors.reduce((sum, visitor) => sum + visitor.scanCount, 0),
      allowedScans: visitors.reduce(
        (sum, visitor) => sum + visitor.allowedCount,
        0,
      ),
      deniedScans: visitors.reduce(
        (sum, visitor) => sum + visitor.deniedCount,
        0,
      ),
      warningScans: visitors.reduce(
        (sum, visitor) => sum + visitor.warningCount,
        0,
      ),
    };
  }

  private formatAppliedFilters(query: VisitorScanTrackingQueryDto) {
    return {
      search: query.search?.trim() || null,
      eventId: query.eventId || null,
      attendeeTypeId: query.attendeeTypeId || null,
      type: query.type || null,
      result: query.result || null,
      state: query.state || null,
      from: query.from || null,
      to: query.to || null,
    };
  }

  private translateState(state: VisitorState) {
    if (state === 'INSIDE') return 'داخل الفعالية';
    if (state === 'OUTSIDE') return 'خارج الفعالية';
    return 'بدون حركة دخول/خروج مسموحة';
  }

  private formatExcelDate(value: Date | null | undefined) {
    if (!value) return '';
    return value.toISOString().replace('T', ' ').slice(0, 19);
  }

  private appendSheet(
    workbook: XLSX.WorkBook,
    name: string,
    rows: unknown[][],
    widths: number[],
  ) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    worksheet['!rows'] = rows.map((_, index) => ({ hpt: index === 0 ? 28 : 24 }));

    if (worksheet['!ref']) {
      worksheet['!autofilter'] = { ref: worksheet['!ref'] };
      const range = XLSX.utils.decode_range(worksheet['!ref']);

      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const style = row === 0 ? HEADER_STYLE : row % 2 === 0 ? ALT_DATA_STYLE : DATA_STYLE;

        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          const cell = worksheet[address] as StyledCell | undefined;
          if (!cell) continue;

          if (typeof cell.v === 'string') {
            cell.t = 's';
            delete cell.f;
          }

          cell.s = style;
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
  }
}
