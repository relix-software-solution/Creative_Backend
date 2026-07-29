import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  EventStatus,
  MovementResult,
  MovementType,
  RegistrationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';

@Injectable()
export class ClientDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser) {
    const clientId = this.getClientIdOrThrow(user);

    /*
     * هذا الفحص دفاع إضافي.
     * المصادقة نفسها أصبحت تمنع العميل المعطّل،
     * لكن لا نعتمد على طبقة واحدة فقط.
     */
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!client) {
      throw new ForbiddenException('Client dashboard access is unavailable');
    }

    const [eventCounts, registrationCounts, uniqueEntryRows, uniqueExitRows] =
      await Promise.all([
        /*
         * عزل الفعاليات يتم من قاعدة البيانات نفسها.
         */
        this.prisma.event.groupBy({
          by: ['status'],
          where: {
            clientId,
          },
          _count: {
            _all: true,
          },
        }),

        /*
         * Registration لا يحتوي clientId.
         * الملكية تأتي من Registration.event.clientId.
         */
        this.prisma.registration.groupBy({
          by: ['status'],
          where: {
            event: {
              clientId,
            },
          },
          _count: {
            _all: true,
          },
        }),

        /*
         * الحضور حسب تعريف النظام الحالي:
         * ENTRY + ALLOWED مع Registration فريد.
         */
        this.prisma.movementLog.findMany({
          where: {
            event: {
              clientId,
            },
            type: MovementType.ENTRY,
            result: MovementResult.ALLOWED,
          },
          select: {
            registrationId: true,
          },
          distinct: ['registrationId'],
        }),

        this.prisma.movementLog.findMany({
          where: {
            event: {
              clientId,
            },
            type: MovementType.EXIT,
            result: MovementResult.ALLOWED,
          },
          select: {
            registrationId: true,
          },
          distinct: ['registrationId'],
        }),
      ]);

    const events = {
      total: this.getTotalCount(eventCounts),
      draft: this.getStatusCount(eventCounts, EventStatus.DRAFT),
      scheduled: this.getStatusCount(eventCounts, EventStatus.SCHEDULED),
      active: this.getStatusCount(eventCounts, EventStatus.ACTIVE),
      completed: this.getStatusCount(eventCounts, EventStatus.COMPLETED),
      cancelled: this.getStatusCount(eventCounts, EventStatus.CANCELLED),
      archived: this.getStatusCount(eventCounts, EventStatus.ARCHIVED),
    };

    const registrations = {
      total: this.getTotalCount(registrationCounts),
      pending: this.getStatusCount(
        registrationCounts,
        RegistrationStatus.PENDING,
      ),
      active: this.getStatusCount(
        registrationCounts,
        RegistrationStatus.ACTIVE,
      ),
      cancelled: this.getStatusCount(
        registrationCounts,
        RegistrationStatus.CANCELLED,
      ),
      blocked: this.getStatusCount(
        registrationCounts,
        RegistrationStatus.BLOCKED,
      ),
      archived: this.getStatusCount(
        registrationCounts,
        RegistrationStatus.ARCHIVED,
      ),
    };

    const uniqueCheckedIn = uniqueEntryRows.length;
    const uniqueExited = uniqueExitRows.length;

    const attendanceRate =
      registrations.active === 0
        ? 0
        : Number(((uniqueCheckedIn / registrations.active) * 100).toFixed(2));

    return {
      generatedAt: new Date().toISOString(),
      client,
      events,
      registrations,
      attendance: {
        uniqueCheckedIn,
        uniqueExited,
        currentInsideApprox: Math.max(uniqueCheckedIn - uniqueExited, 0),
        attendanceRate,
      },
    };
  }

  private getClientIdOrThrow(user: AuthUser): string {
    if (user.role !== UserRole.CLIENT_VIEWER || !user.clientId) {
      throw new ForbiddenException(
        'Client account is not associated with a client',
      );
    }

    return user.clientId;
  }

  private getTotalCount<TStatus extends string>(
    counts: Array<{
      status: TStatus;
      _count: {
        _all: number;
      };
    }>,
  ): number {
    return counts.reduce((total, item) => total + item._count._all, 0);
  }

  private getStatusCount<TStatus extends string>(
    counts: Array<{
      status: TStatus;
      _count: {
        _all: number;
      };
    }>,
    status: TStatus,
  ): number {
    return counts.find((item) => item.status === status)?._count._all ?? 0;
  }
}
