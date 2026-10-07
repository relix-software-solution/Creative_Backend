import { Injectable } from '@nestjs/common';
import {
  DeviceStatus,
  EventStatus,
  ImportJobStatus,
  MovementResult,
  MovementType,
  NotificationStatus,
  RegistrationStatus,
  StaffSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REGISTRATION_TREND_DAYS = 7;
const MOVEMENT_TREND_HOURS = 12;
const ONLINE_DEVICE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_LIMIT = 8;
const EVENT_LIST_LIMIT = 5;
const TOP_EVENTS_LIMIT = 5;

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - DAY_MS);
    const lastHour = new Date(now.getTime() - HOUR_MS);
    const onlineDeviceThreshold = new Date(
      now.getTime() - ONLINE_DEVICE_WINDOW_MS,
    );
    const registrationTrendStart = this.startOfUtcDay(
      new Date(now.getTime() - (REGISTRATION_TREND_DAYS - 1) * DAY_MS),
    );
    const movementTrendStart = this.startOfUtcHour(
      new Date(now.getTime() - (MOVEMENT_TREND_HOURS - 1) * HOUR_MS),
    );

    const [
      totalEvents,
      activeEventsCount,
      upcomingEventsCount,
      totalRegistrations,
      registrationsLast24Hours,
      totalScans,
      scansLastHour,
      totalClients,
      activeClients,
      activeDevices,
      onlineDevices,
      suspendedDevices,
      activeStaffSessions,
      failedNotifications,
      failedNotificationsLast24Hours,
      failedImports,
      pendingImports,
      activeEventRegistrations,
      uniqueActiveEventEntries,
      activeCheckpoints,
      latestAllowedMovements,
      registrationTrendRows,
      movementTrendRows,
      recentRegistrations,
      recentMovements,
      activeEvents,
      upcomingEvents,
      topEvents,
    ] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.event.count({
        where: {
          status: EventStatus.ACTIVE,
          isActive: true,
        },
      }),
      this.prisma.event.count({
        where: {
          status: EventStatus.SCHEDULED,
          isActive: true,
        },
      }),
      this.prisma.registration.count(),
      this.prisma.registration.count({
        where: {
          registeredAt: {
            gte: last24Hours,
          },
        },
      }),
      this.prisma.scanEventRaw.count(),
      this.prisma.scanEventRaw.count({
        where: {
          receivedAtServer: {
            gte: lastHour,
          },
        },
      }),
      this.prisma.client.count(),
      this.prisma.client.count({
        where: {
          isActive: true,
        },
      }),
      this.prisma.device.count({
        where: {
          status: DeviceStatus.ACTIVE,
        },
      }),
      this.prisma.device.count({
        where: {
          status: DeviceStatus.ACTIVE,
          lastSeenAt: {
            gte: onlineDeviceThreshold,
          },
        },
      }),
      this.prisma.device.count({
        where: {
          status: DeviceStatus.SUSPENDED,
        },
      }),
      this.prisma.staffSession.count({
        where: {
          status: StaffSessionStatus.ACTIVE,
        },
      }),
      this.prisma.notificationLog.count({
        where: {
          status: NotificationStatus.FAILED,
        },
      }),
      this.prisma.notificationLog.count({
        where: {
          status: NotificationStatus.FAILED,
          createdAt: {
            gte: last24Hours,
          },
        },
      }),
      this.prisma.importJob.count({
        where: {
          status: {
            in: [ImportJobStatus.FAILED, ImportJobStatus.PARTIAL_FAILED],
          },
        },
      }),
      this.prisma.importJob.count({
        where: {
          status: {
            in: [ImportJobStatus.PENDING, ImportJobStatus.PROCESSING],
          },
        },
      }),
      this.prisma.registration.count({
        where: {
          status: RegistrationStatus.ACTIVE,
          event: {
            status: EventStatus.ACTIVE,
            isActive: true,
          },
        },
      }),
      this.prisma.registration.count({
        where: {
          status: RegistrationStatus.ACTIVE,
          event: {
            status: EventStatus.ACTIVE,
            isActive: true,
          },
          movementLogs: {
            some: {
              type: MovementType.ENTRY,
              result: MovementResult.ALLOWED,
            },
          },
        },
      }),
      this.prisma.checkpoint.count({
        where: {
          event: {
            status: EventStatus.ACTIVE,
            isActive: true,
          },
        },
      }),
      this.prisma.movementLog.findMany({
        where: {
          result: MovementResult.ALLOWED,
          type: {
            in: [MovementType.ENTRY, MovementType.EXIT],
          },
          registration: {
            status: RegistrationStatus.ACTIVE,
          },
          event: {
            status: EventStatus.ACTIVE,
            isActive: true,
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['registrationId'],
        select: {
          registrationId: true,
          type: true,
          eventId: true,
          occurredAt: true,
        },
      }),
      this.prisma.registration.findMany({
        where: {
          registeredAt: {
            gte: registrationTrendStart,
          },
        },
        select: {
          registeredAt: true,
        },
        orderBy: {
          registeredAt: 'asc',
        },
      }),
      this.prisma.movementLog.findMany({
        where: {
          occurredAt: {
            gte: movementTrendStart,
          },
        },
        select: {
          occurredAt: true,
          type: true,
          result: true,
        },
        orderBy: {
          occurredAt: 'asc',
        },
      }),
      this.prisma.registration.findMany({
        take: RECENT_LIMIT,
        orderBy: {
          registeredAt: 'desc',
        },
        select: {
          id: true,
          publicId: true,
          fullName: true,
          phone: true,
          email: true,
          status: true,
          source: true,
          registeredAt: true,
          event: {
            select: {
              id: true,
              titleAr: true,
              titleEn: true,
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
        },
      }),
      this.prisma.movementLog.findMany({
        take: RECENT_LIMIT,
        orderBy: {
          occurredAt: 'desc',
        },
        select: {
          id: true,
          type: true,
          result: true,
          reason: true,
          occurredAt: true,
          registration: {
            select: {
              id: true,
              fullName: true,
            },
          },
          event: {
            select: {
              id: true,
              titleAr: true,
              titleEn: true,
            },
          },
          checkpoint: {
            select: {
              id: true,
              nameAr: true,
              nameEn: true,
              code: true,
            },
          },
        },
      }),
      this.prisma.event.findMany({
        where: {
          status: EventStatus.ACTIVE,
          isActive: true,
        },
        take: EVENT_LIST_LIMIT,
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          startsAt: true,
          endsAt: true,
          status: true,
          timezone: true,
          client: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              registrations: true,
              checkpoints: true,
              staffSessions: true,
            },
          },
        },
      }),
      this.prisma.event.findMany({
        where: {
          status: EventStatus.SCHEDULED,
          isActive: true,
        },
        take: EVENT_LIST_LIMIT,
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          startsAt: true,
          endsAt: true,
          status: true,
          timezone: true,
          client: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              registrations: true,
              checkpoints: true,
              staffSessions: true,
            },
          },
        },
      }),
      this.prisma.event.findMany({
        take: TOP_EVENTS_LIMIT,
        orderBy: {
          registrations: {
            _count: 'desc',
          },
        },
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          status: true,
          startsAt: true,
          endsAt: true,
          client: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              registrations: true,
              movementLogs: true,
            },
          },
        },
      }),
    ]);

    const currentlyInsideRows = latestAllowedMovements.filter(
      (movement) => movement.type === MovementType.ENTRY,
    );
    const currentlyInside = currentlyInsideRows.length;
    const occupancyRate = this.calculateRate(
      currentlyInside,
      activeEventRegistrations,
    );
    const attendanceRate = this.calculateRate(
      uniqueActiveEventEntries,
      activeEventRegistrations,
    );

    return {
      generatedAt: now.toISOString(),
      timezone: 'UTC',
      refreshRecommendedAfterSeconds: 30,
      kpis: {
        totalEvents,
        activeEvents: activeEventsCount,
        upcomingEvents: upcomingEventsCount,
        totalRegistrations,
        registrationsLast24Hours,
        totalScans,
        scansLastHour,
        totalClients,
        activeClients,
        activeDevices,
        onlineDevices,
        activeStaffSessions,
        currentlyInside,
        failedNotifications,
      },
      live: {
        activeEventCount: activeEventsCount,
        activeEventRegistrations,
        uniqueCheckedIn: uniqueActiveEventEntries,
        currentlyInside,
        attendanceRate,
        occupancyRate,
        activeCheckpoints,
        movementsLastHour: scansLastHour,
      },
      alerts: {
        failedNotifications,
        failedNotificationsLast24Hours,
        suspendedDevices,
        failedImports,
        pendingImports,
      },
      registrationTrend: this.buildRegistrationTrend(
        registrationTrendRows.map((row) => row.registeredAt),
        registrationTrendStart,
        now,
      ),
      movementTrend: this.buildMovementTrend(
        movementTrendRows,
        movementTrendStart,
        now,
      ),
      recentRegistrations,
      recentMovements,
      events: {
        active: activeEvents.map((event) => this.mapEventSummary(event)),
        upcoming: upcomingEvents.map((event) => this.mapEventSummary(event)),
      },
      topEvents: topEvents.map((event) => ({
        id: event.id,
        titleAr: event.titleAr,
        titleEn: event.titleEn,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        client: event.client,
        registrations: event._count.registrations,
        movements: event._count.movementLogs,
      })),
    };
  }

  private mapEventSummary(event: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    startsAt: Date;
    endsAt: Date;
    status: EventStatus;
    timezone: string;
    client: { id: string; name: string };
    _count: {
      registrations: number;
      checkpoints: number;
      staffSessions: number;
    };
  }) {
    return {
      id: event.id,
      titleAr: event.titleAr,
      titleEn: event.titleEn,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      timezone: event.timezone,
      client: event.client,
      registrations: event._count.registrations,
      checkpoints: event._count.checkpoints,
      staffSessions: event._count.staffSessions,
    };
  }

  private buildRegistrationTrend(dates: Date[], from: Date, to: Date) {
    const counts = new Map<string, number>();

    for (const date of dates) {
      const key = this.getUtcDayKey(date);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result: Array<{ date: string; count: number }> = [];
    const cursor = new Date(from);
    const end = this.startOfUtcDay(to);

    while (cursor.getTime() <= end.getTime()) {
      const date = this.getUtcDayKey(cursor);
      result.push({
        date,
        count: counts.get(date) ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
  }

  private buildMovementTrend(
    rows: Array<{
      occurredAt: Date;
      type: MovementType;
      result: MovementResult;
    }>,
    from: Date,
    to: Date,
  ) {
    const buckets = new Map<
      string,
      {
        hour: string;
        entries: number;
        exits: number;
        denied: number;
        total: number;
      }
    >();

    for (const row of rows) {
      const hour = this.startOfUtcHour(row.occurredAt).toISOString();
      const bucket = buckets.get(hour) ?? {
        hour,
        entries: 0,
        exits: 0,
        denied: 0,
        total: 0,
      };

      bucket.total += 1;

      if (row.result === MovementResult.DENIED) {
        bucket.denied += 1;
      } else if (
        row.result === MovementResult.ALLOWED &&
        row.type === MovementType.ENTRY
      ) {
        bucket.entries += 1;
      } else if (
        row.result === MovementResult.ALLOWED &&
        row.type === MovementType.EXIT
      ) {
        bucket.exits += 1;
      }

      buckets.set(hour, bucket);
    }

    const result: Array<{
      hour: string;
      entries: number;
      exits: number;
      denied: number;
      total: number;
    }> = [];
    const cursor = new Date(from);
    const end = this.startOfUtcHour(to);

    while (cursor.getTime() <= end.getTime()) {
      const hour = cursor.toISOString();
      result.push(
        buckets.get(hour) ?? {
          hour,
          entries: 0,
          exits: 0,
          denied: 0,
          total: 0,
        },
      );
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }

    return result;
  }

  private calculateRate(value: number, total: number) {
    if (total <= 0) return 0;

    return Number(((value / total) * 100).toFixed(1));
  }

  private startOfUtcDay(value: Date) {
    const result = new Date(value);
    result.setUTCHours(0, 0, 0, 0);
    return result;
  }

  private startOfUtcHour(value: Date) {
    const result = new Date(value);
    result.setUTCMinutes(0, 0, 0);
    return result;
  }

  private getUtcDayKey(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
