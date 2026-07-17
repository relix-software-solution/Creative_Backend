import {
  BadRequestException,
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
import { CreateVenueDto } from './dto/create-venue.dto';
import { ListVenuesQueryDto } from './dto/list-venues-query.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVenueDto: CreateVenueDto) {
    await this.ensureEventCanBeModified(createVenueDto.eventId);

    return this.prisma.venue.create({
      data: createVenueDto,
    });
  }

  async findAll(query: ListVenuesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.VenueWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.search
        ? {
            OR: [
              { nameAr: { contains: query.search } },
              { nameEn: { contains: query.search } },
              { city: { contains: query.search } },
              { country: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.venue.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
    });

    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    return venue;
  }

  async update(id: string, updateVenueDto: UpdateVenueDto) {
    const venue = await this.findOne(id);
    await this.ensureEventCanBeModified(venue.eventId);
    const nextEventId = updateVenueDto.eventId ?? venue.eventId;

    if (nextEventId !== venue.eventId) {
      await this.ensureEventCanBeModified(nextEventId);
      await this.ensureVenueCanMove(id);
    }

    return this.prisma.venue.update({
      where: { id },
      data: updateVenueDto,
    });
  }

  async remove(id: string) {
    const venue = await this.findOne(id);
    await this.ensureEventCanBeModified(venue.eventId);

    const summary = await this.prisma.$transaction(async (tx) => {
      const eventZones = await tx.zone.findMany({
        where: { eventId: venue.eventId },
        select: { id: true, parentId: true, venueId: true },
      });
      const rootIds = eventZones
        .filter((zone) => zone.venueId === id)
        .map((zone) => zone.id);
      const zoneLevels = collectZoneSubtree(eventZones, rootIds);
      const zoneIds = zoneLevels.flat();
      const checkpoints = await tx.checkpoint.findMany({
        where: {
          OR: [
            { venueId: id },
            ...(zoneIds.length ? [{ zoneId: { in: zoneIds } }] : []),
          ],
        },
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

      await tx.venue.delete({ where: { id } });

      return {
        checkpoints: deletedCheckpoints.count,
        zones: zoneIds.length,
      };
    });

    return { deleted: true, id, eventId: venue.eventId, summary };
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

  private async ensureVenueCanMove(id: string) {
    const [zonesCount, checkpointsCount] = await this.prisma.$transaction([
      this.prisma.zone.count({ where: { venueId: id } }),
      this.prisma.checkpoint.count({ where: { venueId: id } }),
    ]);

    if (zonesCount > 0 || checkpointsCount > 0) {
      throw new BadRequestException(
        'Cannot move venue to another event while it has related zones or checkpoints',
      );
    }
  }
}
