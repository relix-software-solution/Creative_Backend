import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MovementResult, MovementType, Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/types/auth-user.type';
import {
  ClientRegistrationAttendanceFilter,
  ClientRegistrationsQueryDto,
  ClientRegistrationSortBy,
  ClientRegistrationSortDirection,
} from './dto/client-registrations-query.dto';

export type ClientRegistrationFilterInput = Pick<
  ClientRegistrationsQueryDto,
  | 'search'
  | 'eventId'
  | 'eventIds'
  | 'attendeeTypeId'
  | 'status'
  | 'source'
  | 'attendance'
  | 'from'
  | 'to'
  | 'eventCountry'
>;

@Injectable()
export class ClientDashboardQueryService {
  getClientIdOrThrow(user: AuthUser): string {
    if (user.role !== UserRole.CLIENT_VIEWER || !user.clientId) {
      throw new ForbiddenException(
        'Client account is not associated with a client',
      );
    }

    return user.clientId;
  }

  validateDateRange(from?: string, to?: string): void {
    if (!from || !to) {
      return;
    }

    if (new Date(from).getTime() > new Date(to).getTime()) {
      throw new BadRequestException('"from" must be before or equal to "to"');
    }
  }

  buildRegistrationWhere(
    clientId: string,
    query: ClientRegistrationFilterInput,
  ): Prisma.RegistrationWhereInput {
    const filters: Prisma.RegistrationWhereInput[] = [
      /*
       * أهم شرط في الاستعلام:
       * التسجيل يجب أن يتبع فعالية العميل.
       */
      {
        event: {
          is: {
            clientId,
          },
        },
      },
    ];

    if (query.search) {
      filters.push({
        OR: [
          {
            publicId: {
              contains: query.search,
            },
          },
          {
            fullName: {
              contains: query.search,
            },
          },
          {
            phone: {
              contains: query.search,
            },
          },
          {
            email: {
              contains: query.search,
            },
          },
          {
            companyName: {
              contains: query.search,
            },
          },
          {
            jobTitle: {
              contains: query.search,
            },
          },
          {
            event: {
              is: {
                OR: [
                  {
                    titleAr: {
                      contains: query.search,
                    },
                  },
                  {
                    titleEn: {
                      contains: query.search,
                    },
                  },
                ],
              },
            },
          },
        ],
      });
    }

    if (query.eventId) {
      filters.push({
        eventId: query.eventId,
      });
    }

    if (query.eventIds && query.eventIds.length > 0) {
      filters.push({
        eventId: {
          in: query.eventIds,
        },
      });
    }

    if (query.attendeeTypeId) {
      filters.push({
        attendeeTypeId: query.attendeeTypeId,
      });
    }

    if (query.status) {
      filters.push({
        status: query.status,
      });
    }

    if (query.source) {
      filters.push({
        source: query.source,
      });
    }

    if (query.from || query.to) {
      filters.push({
        registeredAt: {
          ...(query.from
            ? {
                gte: new Date(query.from),
              }
            : {}),
          ...(query.to
            ? {
                lte: new Date(query.to),
              }
            : {}),
        },
      });
    }

    if (query.eventCountry) {
      filters.push({
        event: {
          is: {
            venues: {
              some: {
                country: {
                  contains: query.eventCountry,
                },
              },
            },
          },
        },
      });
    }

    if (query.attendance === ClientRegistrationAttendanceFilter.ATTENDED) {
      filters.push({
        movementLogs: {
          some: {
            type: MovementType.ENTRY,
            result: MovementResult.ALLOWED,
          },
        },
      });
    }

    if (query.attendance === ClientRegistrationAttendanceFilter.NOT_ATTENDED) {
      filters.push({
        movementLogs: {
          none: {
            type: MovementType.ENTRY,
            result: MovementResult.ALLOWED,
          },
        },
      });
    }

    return {
      AND: filters,
    };
  }

  buildRegistrationOrderBy(
    query: ClientRegistrationsQueryDto,
  ): Prisma.RegistrationOrderByWithRelationInput[] {
    const direction =
      query.sortDirection ?? ClientRegistrationSortDirection.DESC;

    switch (query.sortBy) {
      case ClientRegistrationSortBy.FULL_NAME:
        return [
          {
            fullName: direction,
          },
          {
            id: direction,
          },
        ];

      case ClientRegistrationSortBy.STATUS:
        return [
          {
            status: direction,
          },
          {
            registeredAt: 'desc',
          },
          {
            id: 'desc',
          },
        ];

      case ClientRegistrationSortBy.EVENT_TITLE:
        return [
          {
            event: {
              titleAr: direction,
            },
          },
          {
            registeredAt: 'desc',
          },
          {
            id: 'desc',
          },
        ];

      case ClientRegistrationSortBy.REGISTERED_AT:
      default:
        return [
          {
            registeredAt: direction,
          },
          {
            id: direction,
          },
        ];
    }
  }
}
