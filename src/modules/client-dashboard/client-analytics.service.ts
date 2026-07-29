import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MovementResult,
  MovementType,
  Prisma,
  RegistrationSource,
  RegistrationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import {
  ClientDashboardQueryService,
  ClientRegistrationFilterInput,
} from './client-dashboard-query.service';
import {
  ClientAnalyticsGranularity,
  ClientAnalyticsQueryDto,
} from './dto/client-analytics-query.dto';

const DEFAULT_ANALYTICS_DAYS = 30;
const MAX_ANALYTICS_RANGE_DAYS = 366;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

type AnalyticsPeriod = {
  from: Date;
  to: Date;
};

@Injectable()
export class ClientAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: ClientDashboardQueryService,
  ) {}

  async getAnalytics(user: AuthUser, query: ClientAnalyticsQueryDto) {
    const clientId = this.queryService.getClientIdOrThrow(user);

    const period = this.resolvePeriod(query.from, query.to);

    const filterQuery: ClientRegistrationFilterInput = {
      search: query.search,
      eventId: query.eventId,
      eventIds: query.eventIds,
      attendeeTypeId: query.attendeeTypeId,
      status: query.status,
      source: query.source,
      attendance: query.attendance,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      eventCountry: query.eventCountry,
    };

    const where = this.queryService.buildRegistrationWhere(
      clientId,
      filterQuery,
    );

    const attendedWhere: Prisma.RegistrationWhereInput = {
      AND: [
        where,
        {
          movementLogs: {
            some: {
              type: MovementType.ENTRY,
              result: MovementResult.ALLOWED,
            },
          },
        },
      ],
    };

    const exitedWhere: Prisma.RegistrationWhereInput = {
      AND: [
        where,
        {
          movementLogs: {
            some: {
              type: MovementType.EXIT,
              result: MovementResult.ALLOWED,
            },
          },
        },
      ],
    };

    const [
      totalRegistrations,
      statusGroups,
      sourceGroups,
      eventGroups,
      attendedEventGroups,
      registeredRows,
      uniqueCheckedIn,
      uniqueExited,
    ] = await Promise.all([
      this.prisma.registration.count({
        where,
      }),

      this.prisma.registration.groupBy({
        by: ['status'],
        where,
        _count: {
          _all: true,
        },
      }),

      this.prisma.registration.groupBy({
        by: ['source'],
        where,
        _count: {
          _all: true,
        },
      }),

      this.prisma.registration.groupBy({
        by: ['eventId'],
        where,
        _count: {
          _all: true,
        },
      }),

      this.prisma.registration.groupBy({
        by: ['eventId'],
        where: attendedWhere,
        _count: {
          _all: true,
        },
      }),

      /*
       * المدة محدودة بـ366 يومًا.
       * نحمّل registeredAt فقط لبناء الرسم الزمني.
       */
      this.prisma.registration.findMany({
        where,
        select: {
          registeredAt: true,
        },
        orderBy: {
          registeredAt: 'asc',
        },
      }),

      /*
       * عد تسجيلات فريدة لديها ENTRY مسموح.
       */
      this.prisma.registration.count({
        where: attendedWhere,
      }),

      this.prisma.registration.count({
        where: exitedWhere,
      }),
    ]);

    const eventIds = eventGroups.map((group) => group.eventId);

    const events =
      eventIds.length === 0
        ? []
        : await this.prisma.event.findMany({
            where: {
              clientId,
              id: {
                in: eventIds,
              },
            },
            select: {
              id: true,
              titleAr: true,
              titleEn: true,
              type: true,
              status: true,
              startsAt: true,
              endsAt: true,
              timezone: true,
            },
          });

    const eventMap = new Map(events.map((event) => [event.id, event]));

    const statusCountMap = new Map<RegistrationStatus, number>(
      statusGroups.map((group) => [group.status, group._count._all]),
    );

    const sourceCountMap = new Map<RegistrationSource, number>(
      sourceGroups.map((group) => [group.source, group._count._all]),
    );

    const attendedEventMap = new Map<string, number>(
      attendedEventGroups.map((group) => [group.eventId, group._count._all]),
    );

    const activeRegistrations =
      statusCountMap.get(RegistrationStatus.ACTIVE) ?? 0;

    const cancelledRegistrations =
      statusCountMap.get(RegistrationStatus.CANCELLED) ?? 0;

    const registrationsByStatus = Object.values(RegistrationStatus).map(
      (status) => ({
        status,
        count: statusCountMap.get(status) ?? 0,
      }),
    );

    const registrationsBySource = Object.values(RegistrationSource).map(
      (source) => ({
        source,
        count: sourceCountMap.get(source) ?? 0,
      }),
    );

    const topEvents = eventGroups
      .map((group) => {
        const event = eventMap.get(group.eventId);

        if (!event) {
          return null;
        }

        const registrations = group._count._all;

        const attended = attendedEventMap.get(group.eventId) ?? 0;

        return {
          event,
          registrations,
          attended,
          attendanceRate: this.calculateRate(attended, registrations),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((first, second) => second.registrations - first.registrations)
      .slice(0, query.topLimit ?? 10);

    const granularity = query.granularity ?? ClientAnalyticsGranularity.DAY;

    const registrationsOverTime = this.buildTimeSeries(
      registeredRows.map((row) => row.registeredAt),
      period,
      granularity,
    );

    const eventsWithRegistrations = eventGroups.length;

    return {
      generatedAt: new Date().toISOString(),

      timezone: 'UTC',

      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        granularity,
      },

      overview: {
        totalRegistrations,
        activeRegistrations,
        cancelledRegistrations,

        uniqueCheckedIn,
        uniqueExited,

        currentInsideApprox: Math.max(uniqueCheckedIn - uniqueExited, 0),

        attendanceRate: this.calculateRate(
          uniqueCheckedIn,
          activeRegistrations,
        ),

        cancellationRate: this.calculateRate(
          cancelledRegistrations,
          totalRegistrations,
        ),

        eventsWithRegistrations,

        averageRegistrationsPerEvent:
          eventsWithRegistrations === 0
            ? null
            : this.roundNumber(totalRegistrations / eventsWithRegistrations),
      },

      registrationsByStatus,
      registrationsBySource,
      registrationsOverTime,
      topEvents,
    };
  }

  private resolvePeriod(fromValue?: string, toValue?: string): AnalyticsPeriod {
    const now = new Date();

    let from: Date;
    let to: Date;

    if (fromValue && toValue) {
      from = new Date(fromValue);
      to = new Date(toValue);
    } else if (fromValue) {
      from = new Date(fromValue);
      to = now;
    } else if (toValue) {
      to = new Date(toValue);

      from = new Date(
        to.getTime() - (DEFAULT_ANALYTICS_DAYS - 1) * DAY_IN_MILLISECONDS,
      );

      from.setUTCHours(0, 0, 0, 0);
    } else {
      to = now;

      from = new Date(
        now.getTime() - (DEFAULT_ANALYTICS_DAYS - 1) * DAY_IN_MILLISECONDS,
      );

      from.setUTCHours(0, 0, 0, 0);
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid analytics date range');
    }

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be before or equal to "to"');
    }

    const rangeInDays = (to.getTime() - from.getTime()) / DAY_IN_MILLISECONDS;

    if (rangeInDays > MAX_ANALYTICS_RANGE_DAYS) {
      throw new BadRequestException(
        `Analytics date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days`,
      );
    }

    return {
      from,
      to,
    };
  }

  private buildTimeSeries(
    dates: Date[],
    period: AnalyticsPeriod,
    granularity: ClientAnalyticsGranularity,
  ) {
    const countMap = new Map<string, number>();

    for (const date of dates) {
      const key = this.getBucketKey(date, granularity);

      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const buckets: Array<{
      date: string;
      count: number;
    }> = [];

    let cursor = this.getBucketStart(period.from, granularity);

    const finalBucket = this.getBucketStart(period.to, granularity);

    while (cursor.getTime() <= finalBucket.getTime()) {
      const key = this.getBucketKey(cursor, granularity);

      buckets.push({
        date: key,
        count: countMap.get(key) ?? 0,
      });

      cursor = this.addBucket(cursor, granularity);
    }

    return buckets;
  }

  private getBucketKey(
    date: Date,
    granularity: ClientAnalyticsGranularity,
  ): string {
    return this.getBucketStart(date, granularity).toISOString().slice(0, 10);
  }

  private getBucketStart(
    date: Date,
    granularity: ClientAnalyticsGranularity,
  ): Date {
    const bucket = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );

    if (granularity === ClientAnalyticsGranularity.MONTH) {
      bucket.setUTCDate(1);
      return bucket;
    }

    if (granularity === ClientAnalyticsGranularity.WEEK) {
      /*
       * الأسبوع يبدأ يوم الاثنين.
       */
      const day = bucket.getUTCDay();

      const distanceFromMonday = day === 0 ? 6 : day - 1;

      bucket.setUTCDate(bucket.getUTCDate() - distanceFromMonday);
    }

    return bucket;
  }

  private addBucket(date: Date, granularity: ClientAnalyticsGranularity): Date {
    const next = new Date(date);

    if (granularity === ClientAnalyticsGranularity.MONTH) {
      next.setUTCMonth(next.getUTCMonth() + 1);

      return next;
    }

    if (granularity === ClientAnalyticsGranularity.WEEK) {
      next.setUTCDate(next.getUTCDate() + 7);

      return next;
    }

    next.setUTCDate(next.getUTCDate() + 1);

    return next;
  }

  private calculateRate(numerator: number, denominator: number): number | null {
    if (denominator === 0) {
      return null;
    }

    return this.roundNumber((numerator / denominator) * 100);
  }

  private roundNumber(value: number): number {
    return Number(value.toFixed(2));
  }
}
