import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceStatus,
  EventStatus,
  Prisma,
  StaffSessionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateStaffAssignmentDto } from './dto/create-staff-assignment.dto';
import { ListStaffAssignmentsQueryDto } from './dto/list-staff-assignments-query.dto';
import { UpdateStaffAssignmentDto } from './dto/update-staff-assignment.dto';

type UpdateAssignmentInput = UpdateStaffAssignmentDto & {
  checkpointId?: string;
  deviceId?: string;
  isActive?: boolean;
};

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

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      /*
       * النظام الحالي يعتمد تكليفًا فعالًا واحدًا لكل موظف.
       *
       * لذلك عند إنشاء تكليف جديد:
       * 1. ننهي جلساته السابقة.
       * 2. نوقف تكليفاته الفعالة السابقة.
       * 3. نفعّل أو ننشئ التكليف الجديد.
       */
      await tx.staffSession.updateMany({
        where: {
          staffUserId: createStaffAssignmentDto.userId,
          status: StaffSessionStatus.ACTIVE,
        },
        data: {
          status: StaffSessionStatus.ENDED,
          endedAt: now,
        },
      });

      await tx.staffAssignment.updateMany({
        where: {
          userId: createStaffAssignmentDto.userId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
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
          where: {
            id: existingAssignment.id,
          },
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
      ...(query.isActive === undefined
        ? {}
        : {
            isActive: query.isActive,
          }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffAssignment.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: this.staffAssignmentInclude,
      }),

      this.prisma.staffAssignment.count({
        where,
      }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const staffAssignment = await this.prisma.staffAssignment.findUnique({
      where: {
        id,
      },
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
        user: {
          role: UserRole.STAFF,
          status: UserStatus.ACTIVE,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: this.staffAssignmentInclude,
    });

    if (!staffAssignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    /*
     * لا نعيد تكليفًا فعّالًا إذا تم تعطيل الجهاز أو البوابة.
     * هذا يمنع الفرونت من تشغيل جلسة على تجهيزات لم تعد صالحة.
     */
    if (!staffAssignment.checkpointId || !staffAssignment.checkpoint) {
      throw new BadRequestException(
        'Active staff assignment must include a checkpoint',
      );
    }

    if (!staffAssignment.checkpoint.isActive) {
      throw new BadRequestException('Assigned checkpoint must be active');
    }

    if (!staffAssignment.deviceId || !staffAssignment.device) {
      throw new BadRequestException(
        'Active staff assignment must include a device',
      );
    }

    if (staffAssignment.device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Assigned device must be ACTIVE');
    }

    return staffAssignment;
  }

  async update(id: string, updateStaffAssignmentDto: UpdateStaffAssignmentDto) {
    const staffAssignment = await this.findOne(id);
    const input = updateStaffAssignmentDto as UpdateAssignmentInput;

    await this.ensureEventCanBeModified(staffAssignment.eventId);
    await this.ensureStaffUser(staffAssignment.userId);

    const nextCheckpointId = input.checkpointId ?? staffAssignment.checkpointId;

    const nextDeviceId = input.deviceId ?? staffAssignment.deviceId;

    if (!nextCheckpointId) {
      throw new BadRequestException(
        'Active staff assignment must include checkpointId',
      );
    }

    if (!nextDeviceId) {
      throw new BadRequestException(
        'Active staff assignment must include deviceId',
      );
    }

    await this.ensureCheckpointBelongsToEvent(
      nextCheckpointId,
      staffAssignment.eventId,
    );

    await this.ensureDeviceBelongsToEvent(
      nextDeviceId,
      staffAssignment.eventId,
    );

    const checkpointChanged =
      input.checkpointId !== undefined &&
      input.checkpointId !== staffAssignment.checkpointId;

    const deviceChanged =
      input.deviceId !== undefined &&
      input.deviceId !== staffAssignment.deviceId;

    const explicitlyActivated = input.isActive === true;
    const explicitlyDeactivated = input.isActive === false;
    const now = new Date();

    /*
     * عند إعادة تفعيل تكليف:
     * - ننهي جميع جلسات الموظف القديمة.
     * - نوقف أي تكليف فعّال آخر.
     * - نفعّل التكليف المطلوب.
     */
    if (explicitlyActivated) {
      return this.prisma.$transaction(async (tx) => {
        await tx.staffSession.updateMany({
          where: {
            staffUserId: staffAssignment.userId,
            status: StaffSessionStatus.ACTIVE,
          },
          data: {
            status: StaffSessionStatus.ENDED,
            endedAt: now,
          },
        });

        await tx.staffAssignment.updateMany({
          where: {
            userId: staffAssignment.userId,
            isActive: true,
            id: {
              not: id,
            },
          },
          data: {
            isActive: false,
          },
        });

        return tx.staffAssignment.update({
          where: {
            id,
          },
          data: {
            ...updateStaffAssignmentDto,
            isActive: true,
          },
          include: this.staffAssignmentInclude,
        });
      });
    }

    /*
     * تغيير الجهاز أو البوابة يجب أن ينهي الجلسة القديمة.
     *
     * لا يمكن إبقاء Session مرتبطة بجهاز أو بوابة لم تعد
     * مطابقة للتكليف.
     */
    if (explicitlyDeactivated || checkpointChanged || deviceChanged) {
      return this.prisma.$transaction(async (tx) => {
        await tx.staffSession.updateMany({
          where: {
            eventId: staffAssignment.eventId,
            staffUserId: staffAssignment.userId,
            status: StaffSessionStatus.ACTIVE,
          },
          data: {
            status: StaffSessionStatus.ENDED,
            endedAt: now,
          },
        });

        return tx.staffAssignment.update({
          where: {
            id,
          },
          data: updateStaffAssignmentDto,
          include: this.staffAssignmentInclude,
        });
      });
    }

    return this.prisma.staffAssignment.update({
      where: {
        id,
      },
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

    return {
      deactivated: true,
      staffAssignment,
    };
  }

  private async setActive(id: string, isActive: boolean) {
    const staffAssignment = await this.findOne(id);

    await this.ensureEventCanBeModified(staffAssignment.eventId);

    const now = new Date();

    if (!isActive) {
      return this.prisma.$transaction(async (tx) => {
        await tx.staffSession.updateMany({
          where: {
            eventId: staffAssignment.eventId,
            staffUserId: staffAssignment.userId,
            status: StaffSessionStatus.ACTIVE,
          },
          data: {
            status: StaffSessionStatus.ENDED,
            endedAt: now,
          },
        });

        return tx.staffAssignment.update({
          where: {
            id,
          },
          data: {
            isActive: false,
          },
          include: this.staffAssignmentInclude,
        });
      });
    }

    await this.ensureStaffUser(staffAssignment.userId);

    if (!staffAssignment.checkpointId) {
      throw new BadRequestException(
        'Staff assignment must include checkpointId before activation',
      );
    }

    if (!staffAssignment.deviceId) {
      throw new BadRequestException(
        'Staff assignment must include deviceId before activation',
      );
    }

    await this.ensureCheckpointBelongsToEvent(
      staffAssignment.checkpointId,
      staffAssignment.eventId,
    );

    await this.ensureDeviceBelongsToEvent(
      staffAssignment.deviceId,
      staffAssignment.eventId,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.staffSession.updateMany({
        where: {
          staffUserId: staffAssignment.userId,
          status: StaffSessionStatus.ACTIVE,
        },
        data: {
          status: StaffSessionStatus.ENDED,
          endedAt: now,
        },
      });

      await tx.staffAssignment.updateMany({
        where: {
          userId: staffAssignment.userId,
          isActive: true,
          id: {
            not: id,
          },
        },
        data: {
          isActive: false,
        },
      });

      return tx.staffAssignment.update({
        where: {
          id,
        },
        data: {
          isActive: true,
        },
        include: this.staffAssignmentInclude,
      });
    });
  }

  private async ensureEventCanBeModified(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: {
        id: eventId,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }

    return event;
  }

  private async ensureStaffUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.STAFF) {
      throw new BadRequestException('User must have STAFF role');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Staff user must be ACTIVE');
    }

    return user;
  }

  private async ensureCheckpointBelongsToEvent(
    checkpointId: string,
    eventId: string,
  ) {
    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: {
        id: checkpointId,
      },
    });

    if (!checkpoint) {
      throw new NotFoundException('Checkpoint not found');
    }

    if (checkpoint.eventId !== eventId) {
      throw new BadRequestException('Checkpoint must belong to the same event');
    }

    if (!checkpoint.isActive) {
      throw new BadRequestException('Checkpoint must be active');
    }

    return checkpoint;
  }

  private async ensureDeviceBelongsToEvent(deviceId: string, eventId: string) {
    const device = await this.prisma.device.findUnique({
      where: {
        id: deviceId,
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.eventId !== eventId) {
      throw new BadRequestException('Device must belong to the same event');
    }

    if (device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Device must be ACTIVE');
    }

    return device;
  }

  private readonly staffAssignmentInclude = {
    event: {
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
      },
    },

    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    },

    checkpoint: {
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        type: true,
        code: true,
        isActive: true,
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
