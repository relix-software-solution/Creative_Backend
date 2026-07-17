import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import {
  collectZoneSubtree,
  deleteCheckpointDependencies,
} from '../../common/utils/location-cascade.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { ListZonesQueryDto } from './dto/list-zones-query.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createZoneDto: CreateZoneDto) {
    await this.ensureEventCanBeModified(createZoneDto.eventId);
    await this.ensureVenueBelongsToEvent(
      createZoneDto.venueId,
      createZoneDto.eventId,
    );
    await this.ensureParentBelongsToEvent(
      createZoneDto.parentId,
      createZoneDto.eventId,
    );
    await this.ensureCodeIsUnique(createZoneDto.eventId, createZoneDto.code);

    return this.prisma.zone.create({
      data: createZoneDto,
    });
  }

  async findAll(query: ListZonesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.ZoneWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.venueId ? { venueId: query.venueId } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.search
        ? {
            OR: [
              { nameAr: { contains: query.search } },
              { nameEn: { contains: query.search } },
              { code: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.zone.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.zone.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const zone = await this.prisma.zone.findUnique({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    return zone;
  }

  async update(id: string, updateZoneDto: UpdateZoneDto) {
    const zone = await this.findOne(id);
    await this.ensureEventCanBeModified(zone.eventId);
    const nextEventId = updateZoneDto.eventId ?? zone.eventId;

    if (nextEventId !== zone.eventId) {
      await this.ensureEventCanBeModified(nextEventId);
      await this.ensureZoneCanMove(id);
    }

    if (updateZoneDto.parentId === id) {
      throw new BadRequestException('Zone cannot be its own parent');
    }

    await this.ensureVenueBelongsToEvent(
      updateZoneDto.venueId ?? zone.venueId ?? undefined,
      nextEventId,
    );
    await this.ensureParentBelongsToEvent(
      updateZoneDto.parentId ?? zone.parentId ?? undefined,
      nextEventId,
      id,
    );
    await this.ensureCodeIsUnique(
      nextEventId,
      updateZoneDto.code ?? zone.code ?? undefined,
      id,
    );

    return this.prisma.zone.update({
      where: { id },
      data: updateZoneDto,
    });
  }

  async remove(id: string) {
    const zone = await this.findOne(id);
    await this.ensureEventCanBeModified(zone.eventId);

    const summary = await this.prisma.$transaction(async (tx) => {
      const eventZones = await tx.zone.findMany({
        where: { eventId: zone.eventId },
        select: { id: true, parentId: true },
      });
      const zoneLevels = collectZoneSubtree(eventZones, [id]);
      const zoneIds = zoneLevels.flat();
      const checkpoints = await tx.checkpoint.findMany({
        where: { zoneId: { in: zoneIds } },
        select: { id: true },
      });
      const checkpointIds = checkpoints.map(({ id }) => id);

      await deleteCheckpointDependencies(tx, checkpointIds);
      const deletedCheckpoints = await tx.checkpoint.deleteMany({
        where: { id: { in: checkpointIds } },
      });

      for (const level of [...zoneLevels].reverse()) {
        await tx.zone.deleteMany({ where: { id: { in: level } } });
      }

      return {
        checkpoints: deletedCheckpoints.count,
        zones: Math.max(zoneIds.length - 1, 0),
      };
    });

    return { deleted: true, id, eventId: zone.eventId, summary };
  }

  private async ensureEventCanBeModified(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }
  }

  private async ensureVenueBelongsToEvent(
    venueId: string | undefined,
    eventId: string,
  ) {
    if (!venueId) {
      return;
    }

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    if (venue.eventId !== eventId) {
      throw new BadRequestException('Venue must belong to the same event');
    }
  }

  private async ensureParentBelongsToEvent(
    parentId: string | undefined,
    eventId: string,
    currentZoneId?: string,
  ) {
    if (!parentId) {
      return;
    }

    const parent = await this.prisma.zone.findUnique({
      where: { id: parentId },
    });

    if (!parent) {
      throw new NotFoundException('Parent zone not found');
    }

    if (parent.eventId !== eventId) {
      throw new BadRequestException(
        'Parent zone must belong to the same event',
      );
    }

    if (parent.id === currentZoneId) {
      throw new BadRequestException('Zone cannot be its own parent');
    }
  }

  private async ensureCodeIsUnique(
    eventId: string,
    code: string | undefined,
    excludeId?: string,
  ) {
    if (!code) {
      return;
    }

    const existingZone = await this.prisma.zone.findFirst({
      where: {
        eventId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingZone) {
      throw new ConflictException('Zone code already exists for this event');
    }
  }

  private async ensureZoneCanMove(id: string) {
    const [childrenCount, checkpointsCount] = await this.prisma.$transaction([
      this.prisma.zone.count({ where: { parentId: id } }),
      this.prisma.checkpoint.count({ where: { zoneId: id } }),
    ]);

    if (childrenCount > 0 || checkpointsCount > 0) {
      throw new BadRequestException(
        'Cannot move zone to another event while it has child zones or checkpoints',
      );
    }
  }
}
