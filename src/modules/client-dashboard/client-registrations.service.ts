import { Injectable, NotFoundException } from '@nestjs/common';
import { MovementResult, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ClientDashboardQueryService } from './client-dashboard-query.service';
import { ClientRegistrationsQueryDto } from './dto/client-registrations-query.dto';

const clientRegistrationListSelect =
  Prisma.validator<Prisma.RegistrationSelect>()({
    id: true,
    publicId: true,

    fullName: true,
    phone: true,
    email: true,
    companyName: true,
    jobTitle: true,

    status: true,
    source: true,

    registeredAt: true,
    syncedAt: true,
    createdAt: true,
    updatedAt: true,

    event: {
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        type: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timezone: true,

        venues: {
          select: {
            id: true,
            nameAr: true,
            nameEn: true,
            city: true,
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
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
      },
    },
  });

const clientRegistrationDetailSelect =
  Prisma.validator<Prisma.RegistrationSelect>()({
    id: true,
    publicId: true,

    fullName: true,
    phone: true,
    email: true,
    companyName: true,
    jobTitle: true,

    status: true,
    source: true,

    registeredAt: true,
    syncedAt: true,
    createdAt: true,
    updatedAt: true,

    event: {
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        descriptionAr: true,
        descriptionEn: true,
        type: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timezone: true,

        venues: {
          select: {
            id: true,
            nameAr: true,
            nameEn: true,
            addressAr: true,
            addressEn: true,
            city: true,
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
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
      },
    },
  });

type AttendanceInfo = {
  status: 'NOT_CHECKED_IN' | 'INSIDE' | 'EXITED';

  hasCheckedIn: boolean;
  hasExited: boolean;

  firstCheckedInAt: Date | null;
  lastEntryAt: Date | null;
  lastCheckedOutAt: Date | null;
};

type MutableAttendanceInfo = AttendanceInfo;

@Injectable()
export class ClientRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: ClientDashboardQueryService,
  ) {}

  async findAll(user: AuthUser, query: ClientRegistrationsQueryDto) {
    const clientId = this.queryService.getClientIdOrThrow(user);

    this.queryService.validateDateRange(query.from, query.to);

    const where = this.queryService.buildRegistrationWhere(clientId, query);

    const orderBy = this.queryService.buildRegistrationOrderBy(query);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [registrations, total] = await this.prisma.$transaction([
      this.prisma.registration.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: clientRegistrationListSelect,
      }),

      this.prisma.registration.count({
        where,
      }),
    ]);

    const attendanceMap = await this.getAttendanceMap(
      clientId,
      registrations.map((registration) => registration.id),
    );

    const items = registrations.map((registration) => ({
      ...registration,
      attendance:
        attendanceMap.get(registration.id) ?? this.createEmptyAttendance(),
    }));

    return {
      items,
      total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async findOne(user: AuthUser, registrationId: string) {
    const clientId = this.queryService.getClientIdOrThrow(user);

    /*
     * الملكية ضمن نفس الاستعلام.
     * التسجيل الغريب أو غير الموجود يرجع 404.
     */
    const registration = await this.prisma.registration.findFirst({
      where: {
        id: registrationId,
        event: {
          is: {
            clientId,
          },
        },
      },
      select: clientRegistrationDetailSelect,
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    const attendanceMap = await this.getAttendanceMap(clientId, [
      registration.id,
    ]);

    return {
      ...registration,
      attendance:
        attendanceMap.get(registration.id) ?? this.createEmptyAttendance(),
    };
  }

  private async getAttendanceMap(
    clientId: string,
    registrationIds: string[],
  ): Promise<Map<string, AttendanceInfo>> {
    const result = new Map<string, MutableAttendanceInfo>();

    if (registrationIds.length === 0) {
      return result;
    }

    /*
     * نستخدم groupBy بدل تحميل كل الحركات.
     * نحتاج أول وآخر ENTRY وآخر EXIT فقط.
     */
    const movementGroups = await this.prisma.movementLog.groupBy({
      by: ['registrationId', 'type'],

      where: {
        registrationId: {
          in: registrationIds,
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
      const current =
        result.get(group.registrationId) ?? this.createEmptyAttendance();

      if (group.type === MovementType.ENTRY) {
        current.hasCheckedIn = true;
        current.firstCheckedInAt = group._min.occurredAt;
        current.lastEntryAt = group._max.occurredAt;
      }

      if (group.type === MovementType.EXIT) {
        current.hasExited = true;
        current.lastCheckedOutAt = group._max.occurredAt;
      }

      result.set(group.registrationId, current);
    }

    for (const attendance of result.values()) {
      attendance.status = this.resolveAttendanceStatus(attendance);
    }

    return result;
  }

  private resolveAttendanceStatus(
    attendance: AttendanceInfo,
  ): AttendanceInfo['status'] {
    if (!attendance.hasCheckedIn) {
      return 'NOT_CHECKED_IN';
    }

    if (!attendance.lastCheckedOutAt) {
      return 'INSIDE';
    }

    if (
      attendance.lastEntryAt &&
      attendance.lastEntryAt.getTime() > attendance.lastCheckedOutAt.getTime()
    ) {
      return 'INSIDE';
    }

    return 'EXITED';
  }

  private createEmptyAttendance(): MutableAttendanceInfo {
    return {
      status: 'NOT_CHECKED_IN',
      hasCheckedIn: false,
      hasExited: false,
      firstCheckedInAt: null,
      lastEntryAt: null,
      lastCheckedOutAt: null,
    };
  }
}
