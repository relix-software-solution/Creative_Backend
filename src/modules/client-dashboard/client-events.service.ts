import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import {
  ClientEventsQueryDto,
  ClientEventSortBy,
  ClientSortDirection,
} from './dto/client-events-query.dto';

@Injectable()
export class ClientEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: ClientEventsQueryDto) {
    const clientId = this.getClientIdOrThrow(user);

    this.validateDateRange(query.from, query.to);

    const where = this.buildEventWhere(clientId, query);

    const orderBy = this.buildOrderBy(query);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          titleAr: true,
          titleEn: true,
          descriptionAr: true,
          descriptionEn: true,
          startsAt: true,
          endsAt: true,
          timezone: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,

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

          _count: {
            select: {
              registrations: true,
              attendeeTypes: true,
              venues: true,
            },
          },
        },
      }),

      this.prisma.event.count({
        where,
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async findOne(user: AuthUser, eventId: string) {
    const clientId = this.getClientIdOrThrow(user);

    /*
     * نستخدم findFirst بدل findUnique حتى يكون
     * شرط ملكية العميل داخل نفس استعلام قاعدة البيانات.
     */
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        clientId,
      },
      select: {
        id: true,
        type: true,
        status: true,
        titleAr: true,
        titleEn: true,
        descriptionAr: true,
        descriptionEn: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        allowReEntry: true,
        duplicateStrategy: true,
        qrValidFrom: true,
        qrValidUntil: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,

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

        attendeeTypes: {
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            descriptionAr: true,
            descriptionEn: true,
            isActive: true,
            sortOrder: true,
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },

        _count: {
          select: {
            registrations: true,
            attendeeTypes: true,
            venues: true,
            checkpoints: true,
          },
        },
      },
    });

    /*
     * نفس 404 سواء الفعالية غير موجودة أو تخص عميلًا آخر،
     * حتى لا نكشف وجود بيانات عميل آخر.
     */
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  private buildEventWhere(
    clientId: string,
    query: ClientEventsQueryDto,
  ): Prisma.EventWhereInput {
    const filters: Prisma.EventWhereInput[] = [
      {
        clientId,
      },
    ];

    if (query.search) {
      filters.push({
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
      });
    }

    if (query.status) {
      filters.push({
        status: query.status,
      });
    }

    if (query.type) {
      filters.push({
        type: query.type,
      });
    }

    if (query.from || query.to) {
      filters.push({
        startsAt: {
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

    if (query.country) {
      filters.push({
        venues: {
          some: {
            country: {
              contains: query.country,
            },
          },
        },
      });
    }

    return {
      AND: filters,
    };
  }

  private buildOrderBy(
    query: ClientEventsQueryDto,
  ): Prisma.EventOrderByWithRelationInput {
    const direction = query.sortDirection ?? ClientSortDirection.DESC;

    switch (query.sortBy) {
      case ClientEventSortBy.ENDS_AT:
        return {
          endsAt: direction,
        };

      case ClientEventSortBy.CREATED_AT:
        return {
          createdAt: direction,
        };

      case ClientEventSortBy.TITLE_AR:
        return {
          titleAr: direction,
        };

      case ClientEventSortBy.STATUS:
        return {
          status: direction,
        };

      case ClientEventSortBy.STARTS_AT:
      default:
        return {
          startsAt: direction,
        };
    }
  }

  private validateDateRange(from?: string, to?: string) {
    if (!from || !to) {
      return;
    }

    if (new Date(from).getTime() > new Date(to).getTime()) {
      throw new BadRequestException('"from" must be before or equal to "to"');
    }
  }

  private getClientIdOrThrow(user: AuthUser): string {
    if (user.role !== UserRole.CLIENT_VIEWER || !user.clientId) {
      throw new ForbiddenException(
        'Client account is not associated with a client',
      );
    }

    return user.clientId;
  }
}
