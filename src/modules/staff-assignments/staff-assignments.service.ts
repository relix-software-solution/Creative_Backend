import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, UserRole } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateStaffAssignmentDto } from './dto/create-staff-assignment.dto';
import { ListStaffAssignmentsQueryDto } from './dto/list-staff-assignments-query.dto';
import { UpdateStaffAssignmentDto } from './dto/update-staff-assignment.dto';

@Injectable()
export class StaffAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createStaffAssignmentDto: CreateStaffAssignmentDto) {
    await this.ensureEventCanBeModified(createStaffAssignmentDto.eventId);
    await this.ensureStaffUser(createStaffAssignmentDto.userId);
    await this.ensureCheckpointBelongsToEvent(
      createStaffAssignmentDto.checkpointId,
      createStaffAssignmentDto.eventId,
    );
    await this.ensureDeviceBelongsToEvent(
      createStaffAssignmentDto.deviceId,
      createStaffAssignmentDto.eventId,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.staffAssignment.updateMany({
        where: {
          userId: createStaffAssignmentDto.userId,
          isActive: true,
        },
        data: { isActive: false },
      });

      const existingAssignment = await tx.staffAssignment.findUnique({
        where: {
          eventId_userId: {
            eventId: createStaffAssignmentDto.eventId,
            userId: createStaffAssignmentDto.userId,
          },
        },
      });

      if (existingAssignment) {
        return tx.staffAssignment.update({
          where: { id: existingAssignment.id },
          data: {
            checkpointId: createStaffAssignmentDto.checkpointId,
            deviceId: createStaffAssignmentDto.deviceId,
            notes: createStaffAssignmentDto.notes,
            isActive: true,
          },
          include: this.staffAssignmentInclude,
        });
      }

      return tx.staffAssignment.create({
        data: createStaffAssignmentDto,
        include: this.staffAssignmentInclude,
      });
    });
  }

  async findAll(query: ListStaffAssignmentsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.StaffAssignmentWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffAssignment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ...this.staffAssignmentInclude,
        },
      }),
      this.prisma.staffAssignment.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const staffAssignment = await this.prisma.staffAssignment.findUnique({
      where: { id },
      include: this.staffAssignmentInclude,
    });

    if (!staffAssignment) {
      throw new NotFoundException('Staff assignment not found');
    }

    return staffAssignment;
  }

  async findMyActive(userId: string) {
    const staffAssignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      include: this.staffAssignmentInclude,
    });

    if (!staffAssignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    return staffAssignment;
  }

  async update(id: string, updateStaffAssignmentDto: UpdateStaffAssignmentDto) {
    const staffAssignment = await this.findOne(id);
    await this.ensureEventCanBeModified(staffAssignment.eventId);

    return this.prisma.staffAssignment.update({
      where: { id },
      data: updateStaffAssignmentDto,
      include: this.staffAssignmentInclude,
    });
  }

  async activate(id: string) {
    return this.setActive(id, true);
  }

  async deactivate(id: string) {
    return this.setActive(id, false);
  }

  async remove(id: string) {
    const staffAssignment = await this.setActive(id, false);

    return { deactivated: true, staffAssignment };
  }

  private async setActive(id: string, isActive: boolean) {
    const staffAssignment = await this.findOne(id);
    await this.ensureEventCanBeModified(staffAssignment.eventId);

    return this.prisma.staffAssignment.update({
      where: { id },
      data: { isActive },
      include: this.staffAssignmentInclude,
    });
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

  private async ensureStaffUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.STAFF) {
      throw new BadRequestException('User must have STAFF role');
    }
  }

  private async ensureCheckpointBelongsToEvent(
    checkpointId: string,
    eventId: string,
  ) {
    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: { id: checkpointId },
    });

    if (!checkpoint) {
      throw new NotFoundException('Checkpoint not found');
    }

    if (checkpoint.eventId !== eventId) {
      throw new BadRequestException('Checkpoint must belong to the same event');
    }
  }

  private async ensureDeviceBelongsToEvent(deviceId: string, eventId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.eventId !== eventId) {
      throw new BadRequestException('Device must belong to the same event');
    }
  }

  private readonly staffAssignmentInclude = {
    event: {
      select: { id: true, titleAr: true, titleEn: true },
    },
    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
      },
    },
    checkpoint: {
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        type: true,
        code: true,
      },
    },
    device: {
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
      },
    },
  } satisfies Prisma.StaffAssignmentInclude;
}
