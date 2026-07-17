import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MovementResult,
  MovementType,
  QrTokenStatus,
  RegistrationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { MovementsByHourQueryDto } from './dto/movements-by-hour-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser, eventId: string) {
    const event = await this.assertCanViewEvent(user, eventId);
    const [
      registrationCounts,
      movementCounts,
      qrCounts,
      uniqueEntryRows,
      uniqueExitRows,
    ] = await Promise.all([
      this.prisma.registration.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.movementLog.groupBy({
        by: ['type', 'result'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.qrToken.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.movementLog.findMany({
        where: {
          eventId,
          type: MovementType.ENTRY,
          result: MovementResult.ALLOWED,
        },
        select: { registrationId: true },
        distinct: ['registrationId'],
      }),
      this.prisma.movementLog.findMany({
        where: {
          eventId,
          type: MovementType.EXIT,
          result: MovementResult.ALLOWED,
        },
        select: { registrationId: true },
        distinct: ['registrationId'],
      }),
    ]);
    const registrations = this.countByStatus(registrationCounts);
    const movements = this.countMovements(movementCounts);
    const qr = this.countQr(qrCounts);
    const uniqueCheckedIn = uniqueEntryRows.length;
    const uniqueExited = uniqueExitRows.length;
    const activeRegistrations = registrations.active;

    return {
      event: {
        id: event.id,
        titleAr: event.titleAr,
        titleEn: event.titleEn,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      registrations,
      movements,
      attendance: {
        uniqueCheckedIn,
        currentInsideApprox: Math.max(uniqueCheckedIn - uniqueExited, 0),
        attendanceRate:
          activeRegistrations === 0
            ? 0
            : Number(((uniqueCheckedIn / activeRegistrations) * 100).toFixed(2)),
      },
      qr,
    };
  }

  async registrationsByType(user: AuthUser, eventId: string) {
    await this.assertCanViewEvent(user, eventId);

    const attendeeTypes = await this.prisma.attendeeType.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.registration.groupBy({
      by: ['attendeeTypeId', 'status'],
      where: { eventId },
      _count: { _all: true },
    });

    return attendeeTypes.map((attendeeType) => {
      const matchingCounts = counts.filter(
        (count) => count.attendeeTypeId === attendeeType.id,
      );

      return {
        attendeeTypeId: attendeeType.id,
        attendeeTypeCode: attendeeType.code,
        attendeeTypeNameAr: attendeeType.nameAr,
        attendeeTypeNameEn: attendeeType.nameEn,
        total: matchingCounts.reduce((sum, count) => sum + count._count._all, 0),
        active: this.getStatusCount(matchingCounts, RegistrationStatus.ACTIVE),
        cancelled: this.getStatusCount(
          matchingCounts,
          RegistrationStatus.CANCELLED,
        ),
        blocked: this.getStatusCount(matchingCounts, RegistrationStatus.BLOCKED),
      };
    });
  }

  async movementsByType(user: AuthUser, eventId: string) {
    await this.assertCanViewEvent(user, eventId);

    const counts = await this.prisma.movementLog.groupBy({
      by: ['type', 'result'],
      where: { eventId },
      _count: { _all: true },
    });

    return counts.map((count) => ({
      type: count.type,
      result: count.result,
      count: count._count._all,
    }));
  }

  async movementsByHour(
    user: AuthUser,
    eventId: string,
    query: MovementsByHourQueryDto,
  ) {
    await this.assertCanViewEvent(user, eventId);

    const movements = await this.prisma.movementLog.findMany({
      where: {
        eventId,
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      select: { occurredAt: true, result: true },
      orderBy: { occurredAt: 'asc' },
    });
    const buckets = new Map<
      string,
      { hour: string; total: number; allowed: number; denied: number }
    >();

    for (const movement of movements) {
      const hour = this.truncateToHour(movement.occurredAt).toISOString();
      const bucket =
        buckets.get(hour) ?? { hour, total: 0, allowed: 0, denied: 0 };

      bucket.total += 1;

      if (movement.result === MovementResult.ALLOWED) {
        bucket.allowed += 1;
      } else if (movement.result === MovementResult.DENIED) {
        bucket.denied += 1;
      }

      buckets.set(hour, bucket);
    }

    return Array.from(buckets.values());
  }

  async checkpoints(user: AuthUser, eventId: string) {
    await this.assertCanViewEvent(user, eventId);

    const [checkpoints, counts] = await Promise.all([
      this.prisma.checkpoint.findMany({
        where: { eventId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.movementLog.groupBy({
        by: ['checkpointId', 'type', 'result'],
        where: { eventId },
        _count: { _all: true },
      }),
    ]);

    return checkpoints.map((checkpoint) => {
      const matchingCounts = counts.filter(
        (count) => count.checkpointId === checkpoint.id,
      );

      return {
        checkpointId: checkpoint.id,
        checkpointCode: checkpoint.code,
        checkpointNameAr: checkpoint.nameAr,
        checkpointNameEn: checkpoint.nameEn,
        totalMovements: matchingCounts.reduce(
          (sum, count) => sum + count._count._all,
          0,
        ),
        allowed: this.getMovementResultCount(
          matchingCounts,
          MovementResult.ALLOWED,
        ),
        denied: this.getMovementResultCount(
          matchingCounts,
          MovementResult.DENIED,
        ),
        entries: this.getMovementTypeCount(matchingCounts, MovementType.ENTRY),
        exits: this.getMovementTypeCount(matchingCounts, MovementType.EXIT),
      };
    });
  }

  async staffPerformance(user: AuthUser, eventId: string) {
    await this.assertCanViewEvent(user, eventId);

    const sessions = await this.prisma.staffSession.findMany({
      where: { eventId },
      include: {
        staffUser: {
          select: { id: true, fullName: true },
        },
      },
    });
    const counts = await this.prisma.movementLog.groupBy({
      by: ['staffSessionId', 'result'],
      where: { eventId, staffSessionId: { not: null } },
      _count: { _all: true },
    });
    const byStaff = new Map<
      string,
      {
        staffUserId: string;
        fullName: string;
        totalMovements: number;
        allowed: number;
        denied: number;
        activeSessionsCount: number;
        lastSeenAt: Date | null;
      }
    >();

    for (const session of sessions) {
      const report =
        byStaff.get(session.staffUserId) ??
        {
          staffUserId: session.staffUserId,
          fullName: session.staffUser.fullName,
          totalMovements: 0,
          allowed: 0,
          denied: 0,
          activeSessionsCount: 0,
          lastSeenAt: null,
        };
      const sessionCounts = counts.filter(
        (count) => count.staffSessionId === session.id,
      );

      report.totalMovements += sessionCounts.reduce(
        (sum, count) => sum + count._count._all,
        0,
      );
      report.allowed += this.getMovementResultCount(
        sessionCounts,
        MovementResult.ALLOWED,
      );
      report.denied += this.getMovementResultCount(
        sessionCounts,
        MovementResult.DENIED,
      );

      if (session.status === 'ACTIVE') {
        report.activeSessionsCount += 1;
      }

      if (
        session.lastSeenAt &&
        (!report.lastSeenAt || session.lastSeenAt > report.lastSeenAt)
      ) {
        report.lastSeenAt = session.lastSeenAt;
      }

      byStaff.set(session.staffUserId, report);
    }

    return Array.from(byStaff.values());
  }

  private async assertCanViewEvent(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        clientId: true,
        titleAr: true,
        titleEn: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      return event;
    }

    if (user.role === UserRole.CLIENT_VIEWER && user.clientId === event.clientId) {
      return event;
    }

    throw new ForbiddenException('You cannot view reports for this event');
  }

  private countByStatus(
    counts: Array<{ status: RegistrationStatus; _count: { _all: number } }>,
  ) {
    const total = counts.reduce((sum, count) => sum + count._count._all, 0);

    return {
      total,
      active: this.getStatusCount(counts, RegistrationStatus.ACTIVE),
      cancelled: this.getStatusCount(counts, RegistrationStatus.CANCELLED),
      blocked: this.getStatusCount(counts, RegistrationStatus.BLOCKED),
      archived: this.getStatusCount(counts, RegistrationStatus.ARCHIVED),
    };
  }

  private countMovements(
    counts: Array<{
      type: MovementType;
      result: MovementResult;
      _count: { _all: number };
    }>,
  ) {
    return {
      total: counts.reduce((sum, count) => sum + count._count._all, 0),
      allowed: this.getMovementResultCount(counts, MovementResult.ALLOWED),
      denied: this.getMovementResultCount(counts, MovementResult.DENIED),
      warnings: this.getMovementResultCount(counts, MovementResult.WARNING),
      entries: this.getMovementTypeCount(counts, MovementType.ENTRY),
      exits: this.getMovementTypeCount(counts, MovementType.EXIT),
    };
  }

  private countQr(
    counts: Array<{ status: QrTokenStatus; _count: { _all: number } }>,
  ) {
    return {
      totalGenerated: counts.reduce((sum, count) => sum + count._count._all, 0),
      active: counts.find((count) => count.status === QrTokenStatus.ACTIVE)
        ?._count._all ?? 0,
      revoked: counts.find((count) => count.status === QrTokenStatus.REVOKED)
        ?._count._all ?? 0,
      expired: counts.find((count) => count.status === QrTokenStatus.EXPIRED)
        ?._count._all ?? 0,
    };
  }

  private getStatusCount<TStatus extends string>(
    counts: Array<{ status: TStatus; _count: { _all: number } }>,
    status: TStatus,
  ) {
    return counts.find((count) => count.status === status)?._count._all ?? 0;
  }

  private getMovementResultCount(
    counts: Array<{ result: MovementResult; _count: { _all: number } }>,
    result: MovementResult,
  ) {
    return counts
      .filter((count) => count.result === result)
      .reduce((sum, count) => sum + count._count._all, 0);
  }

  private getMovementTypeCount(
    counts: Array<{ type: MovementType; _count: { _all: number } }>,
    type: MovementType,
  ) {
    return counts
      .filter((count) => count.type === type)
      .reduce((sum, count) => sum + count._count._all, 0);
  }

  private truncateToHour(date: Date) {
    const hour = new Date(date);
    hour.setUTCMinutes(0, 0, 0);

    return hour;
  }
}
