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
import { CreateAttendeeTypeDto } from './dto/create-attendee-type.dto';
import { ListAttendeeTypesQueryDto } from './dto/list-attendee-types-query.dto';
import { UpdateAttendeeTypeDto } from './dto/update-attendee-type.dto';

@Injectable()
export class AttendeeTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createAttendeeTypeDto: CreateAttendeeTypeDto) {
    await this.ensureEventCanBeModified(createAttendeeTypeDto.eventId);

    const code = this.normalizeCode(createAttendeeTypeDto.code);
    await this.ensureCodeIsUnique(createAttendeeTypeDto.eventId, code);

    const data = {
      ...createAttendeeTypeDto,
      code,
    };

    if (data.isDefault) {
      return this.prisma.$transaction(async (tx) => {
        await tx.attendeeType.updateMany({
          where: { eventId: data.eventId },
          data: { isDefault: false },
        });

        return tx.attendeeType.create({ data });
      });
    }

    return this.prisma.attendeeType.create({ data });
  }

  async findAll(query: ListAttendeeTypesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.AttendeeTypeWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search } },
              { nameAr: { contains: query.search } },
              { nameEn: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendeeType.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.attendeeType.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const attendeeType = await this.prisma.attendeeType.findUnique({
      where: { id },
    });

    if (!attendeeType) {
      throw new NotFoundException('Attendee type not found');
    }

    return attendeeType;
  }

  async update(id: string, updateAttendeeTypeDto: UpdateAttendeeTypeDto) {
    const attendeeType = await this.findOne(id);
    await this.ensureEventCanBeModified(attendeeType.eventId);

    const code = updateAttendeeTypeDto.code
      ? this.normalizeCode(updateAttendeeTypeDto.code)
      : undefined;

    if (code) {
      await this.ensureCodeIsUnique(attendeeType.eventId, code, id);
    }

    const data = {
      ...updateAttendeeTypeDto,
      code,
    };

    if (data.isDefault) {
      return this.prisma.$transaction(async (tx) => {
        await tx.attendeeType.updateMany({
          where: {
            eventId: attendeeType.eventId,
            id: { not: id },
          },
          data: { isDefault: false },
        });

        return tx.attendeeType.update({
          where: { id },
          data,
        });
      });
    }

    return this.prisma.attendeeType.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const attendeeType = await this.findOne(id);
    await this.ensureEventCanBeModified(attendeeType.eventId);

    const registrationCount = await this.prisma.registration.count({
      where: { attendeeTypeId: id },
    });

    if (registrationCount > 0) {
      throw new ConflictException(
        'Cannot delete attendee type with registrations',
      );
    }

    await this.prisma.attendeeType.delete({ where: { id } });

    return {
      success: true,
      deleted: true,
      id,
      eventId: attendeeType.eventId,
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

  private async ensureCodeIsUnique(
    eventId: string,
    code: string,
    excludeId?: string,
  ) {
    const existingAttendeeType = await this.prisma.attendeeType.findFirst({
      where: {
        eventId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingAttendeeType) {
      throw new ConflictException(
        'Attendee type code already exists for this event',
      );
    }
  }

  private normalizeCode(code: string) {
    return code.trim().replace(/[\s-]+/g, '_').toUpperCase();
  }
}
