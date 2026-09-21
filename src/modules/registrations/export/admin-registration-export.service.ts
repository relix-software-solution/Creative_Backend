import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { RegistrationExcelExporter } from '../../../common/utils/registration-excel-exporter';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.type';
import { ListRegistrationsQueryDto } from '../dto/list-registrations-query.dto';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type AdminRegistrationExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: typeof XLSX_CONTENT_TYPE;
  rowCount: number;
};

export type AdminRegistrationExportContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AdminRegistrationExportService {
  private readonly logger = new Logger(AdminRegistrationExportService.name);
  private readonly activeExports = new Set<string>();
  private readonly exporter: RegistrationExcelExporter;

  constructor(private readonly prisma: PrismaService) {
    this.exporter = new RegistrationExcelExporter(prisma);
  }

  async exportRegistrations(
    user: AuthUser,
    query: ListRegistrationsQueryDto,
    context: AdminRegistrationExportContext,
  ): Promise<AdminRegistrationExportResult | null> {
    if (this.activeExports.has(user.id)) {
      throw new HttpException(
        'A registration export is already running',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeExports.add(user.id);

    const startedAt = Date.now();
    const filtersHash = this.createFiltersHash(query);
    let rowCount = 0;

    try {
      const result = await this.exporter.export({
        where: this.buildWhere(query),
        orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
        attendeeTypeId: query.attendeeTypeId,
      });

      rowCount = result?.rowCount ?? 0;

      await this.writeAuditLog({
        user,
        context,
        filtersHash,
        rowCount,
        outcome: 'completed',
        durationMs: Date.now() - startedAt,
      });

      if (!result) {
        return null;
      }

      return {
        buffer: result.buffer,
        filename: this.createFilename(),
        contentType: XLSX_CONTENT_TYPE,
        rowCount: result.rowCount,
      };
    } catch (error) {
      await this.writeAuditLog({
        user,
        context,
        filtersHash,
        rowCount,
        outcome: 'failed',
        durationMs: Date.now() - startedAt,
      });

      throw error;
    } finally {
      this.activeExports.delete(user.id);
    }
  }

  private buildWhere(
    query: ListRegistrationsQueryDto,
  ): Prisma.RegistrationWhereInput {
    return {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId ? { attendeeTypeId: query.attendeeTypeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search } },
              { phone: { contains: query.search } },
              { email: { contains: query.search } },
              { companyName: { contains: query.search } },
              { externalId: { contains: query.search } },
            ],
          }
        : {}),
    };
  }

  private createFilename(): string {
    const date = new Date().toISOString().slice(0, 10);

    return `admin-registrations-${date}.xlsx`;
  }

  private createFiltersHash(query: ListRegistrationsQueryDto): string {
    const normalizedFilters = {
      search: query.search ?? null,
      eventId: query.eventId ?? null,
      attendeeTypeId: query.attendeeTypeId ?? null,
      status: query.status ?? null,
      source: query.source ?? null,
    };

    return createHash('sha256')
      .update(JSON.stringify(normalizedFilters))
      .digest('hex');
  }

  private async writeAuditLog(input: {
    user: AuthUser;
    context: AdminRegistrationExportContext;
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
          entityType: 'ADMIN_REGISTRATION_EXPORT',
          entityId: input.user.id,
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
      this.logger.warn('Failed to write admin registration export audit log');
    }
  }
}
