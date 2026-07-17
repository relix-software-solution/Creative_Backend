import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateCheckpointDto } from './dto/create-checkpoint.dto';
import { ListCheckpointsQueryDto } from './dto/list-checkpoints-query.dto';
import { UpdateCheckpointDto } from './dto/update-checkpoint.dto';

@Injectable()
export class CheckpointsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCheckpointDto: CreateCheckpointDto) {
    await this.ensureEventCanBeModified(createCheckpointDto.eventId);
    await this.ensureVenueBelongsToEvent(
      createCheckpointDto.venueId,
      createCheckpointDto.eventId,
    );
    await this.ensureZoneBelongsToEvent(
      createCheckpointDto.zoneId,
      createCheckpointDto.eventId,
    );
    await this.ensureCodeIsUnique(
      createCheckpointDto.eventId,
      createCheckpointDto.code,
    );

    return this.prisma.checkpoint.create({
      data: {
        ...createCheckpointDto,
        allowedAttendeeTypes:
          createCheckpointDto.allowedAttendeeTypes ?? Prisma.JsonNull,
      },
    });
  }

  async findAll(query: ListCheckpointsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.CheckpointWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.venueId ? { venueId: query.venueId } : {}),
      ...(query.zoneId ? { zoneId: query.zoneId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
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
      this.prisma.checkpoint.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.checkpoint.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: { id },
    });

    if (!checkpoint) {
      throw new NotFoundException('Checkpoint not found');
    }

    return checkpoint;
  }

  async update(id: string, updateCheckpointDto: UpdateCheckpointDto) {
    const checkpoint = await this.findOne(id);
    await this.ensureEventCanBeModified(checkpoint.eventId);
    const nextEventId = updateCheckpointDto.eventId ?? checkpoint.eventId;

    if (nextEventId !== checkpoint.eventId) {
      await this.ensureEventCanBeModified(nextEventId);
    }

    await this.ensureVenueBelongsToEvent(
      updateCheckpointDto.venueId ?? checkpoint.venueId ?? undefined,
      nextEventId,
    );
    await this.ensureZoneBelongsToEvent(
      updateCheckpointDto.zoneId ?? checkpoint.zoneId ?? undefined,
      nextEventId,
    );
    await this.ensureCodeIsUnique(
      nextEventId,
      updateCheckpointDto.code ?? checkpoint.code,
      id,
    );

    return this.prisma.checkpoint.update({
      where: { id },
      data: {
        ...updateCheckpointDto,
        allowedAttendeeTypes:
          updateCheckpointDto.allowedAttendeeTypes === undefined
            ? undefined
            : updateCheckpointDto.allowedAttendeeTypes,
      },
    });
  }

  async remove(id: string) {
    const checkpoint = await this.findOne(id);
    await this.ensureEventCanBeModified(checkpoint.eventId);

    const [
      movementLogs,
      scanEvents,
      staffSessions,
      staffAssignments,
      syncBatches,
    ] = await this.prisma.$transaction([
      this.prisma.movementLog.count({ where: { checkpointId: id } }),
      this.prisma.scanEventRaw.count({ where: { checkpointId: id } }),
      this.prisma.staffSession.count({ where: { checkpointId: id } }),
      this.prisma.staffAssignment.count({ where: { checkpointId: id } }),
      this.prisma.syncBatch.count({ where: { checkpointId: id } }),
    ]);

    if (
      movementLogs > 0 ||
      scanEvents > 0 ||
      staffSessions > 0 ||
      staffAssignments > 0 ||
      syncBatches > 0
    ) {
      throw new ConflictException(
        'Cannot delete checkpoint while scan history, sessions, assignments, or sync batches reference it',
      );
    }

    await this.prisma.checkpoint.delete({ where: { id } });

    return {
      success: true,
      deleted: true,
      id,
      eventId: checkpoint.eventId,
    };
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

  private async ensureZoneBelongsToEvent(
    zoneId: string | undefined,
    eventId: string,
  ) {
    if (!zoneId) {
      return;
    }

    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
    });

    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    if (zone.eventId !== eventId) {
      throw new BadRequestException('Zone must belong to the same event');
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

    const existingCheckpoint = await this.prisma.checkpoint.findFirst({
      where: {
        eventId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingCheckpoint) {
      throw new ConflictException(
        'Checkpoint code already exists for this event',
      );
    }
  }
}
