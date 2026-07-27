import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Checkpoint,
  CheckpointType,
  DeviceStatus,
  EventStatus,
  Prisma,
  StaffScanMode,
  StaffSessionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { ListStaffSessionsQueryDto } from './dto/list-staff-sessions-query.dto';
import { StartStaffSessionDto } from './dto/start-staff-session.dto';

type SafeStaffSessionPayload = {
  id: string;
  eventId: string;
  checkpointId: string;
  deviceId: string;
  staffUserId: string;
  mode: StaffScanMode;
  status: StaffSessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  lastSeenAt: Date | null;

  event: {
    id: string;
    titleAr: string;
    titleEn: string | null;
  };

  checkpoint: {
    id: string;
    nameAr: string;
    nameEn?: string | null;
    code?: string;
    type: CheckpointType;
  };

  device: {
    id: string;
    name: string;
    code: string;
  };
};

@Injectable()
export class StaffSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    currentUser: AuthUser,
    startStaffSessionDto: StartStaffSessionDto,
  ) {
    const staffUserId = this.resolveStaffUserId(
      currentUser,
      startStaffSessionDto.staffUserId,
    );

    await this.ensureEventCanBeModified(startStaffSessionDto.eventId);
    await this.ensureStaffUser(staffUserId);

    const device = await this.ensureActiveDeviceBelongsToEvent(
      startStaffSessionDto.deviceId,
      startStaffSessionDto.eventId,
    );

    const checkpoint = await this.ensureActiveCheckpointBelongsToEvent(
      startStaffSessionDto.checkpointId,
      startStaffSessionDto.eventId,
    );

    await this.ensureActiveAssignmentBinding({
      eventId: startStaffSessionDto.eventId,
      staffUserId,
      deviceId: device.id,
      checkpointId: checkpoint.id,
    });

    const expectedMode = this.resolveModeForCheckpoint(checkpoint.type);

    if (startStaffSessionDto.mode !== expectedMode) {
      throw new BadRequestException(
        `Staff session mode must match checkpoint type. Expected ${expectedMode}`,
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      /*
       * الموظف لا يجب أن يمتلك جلستين فعالتين في الوقت نفسه،
       * حتى لو كانتا ضمن فعاليتين مختلفتين.
       */
      await tx.staffSession.updateMany({
        where: {
          staffUserId,
          status: StaffSessionStatus.ACTIVE,
        },
        data: {
          status: StaffSessionStatus.ENDED,
          endedAt: now,
        },
      });

      /*
       * الجهاز نفسه لا يجب أن يكون مستخدمًا من جلستين
       * فعالتين ضمن الفعالية نفسها.
       */
      await tx.staffSession.updateMany({
        where: {
          eventId: startStaffSessionDto.eventId,
          deviceId: startStaffSessionDto.deviceId,
          status: StaffSessionStatus.ACTIVE,
        },
        data: {
          status: StaffSessionStatus.ENDED,
          endedAt: now,
        },
      });

      const staffSession = await tx.staffSession.create({
        data: {
          eventId: startStaffSessionDto.eventId,
          staffUserId,
          deviceId: startStaffSessionDto.deviceId,
          checkpointId: startStaffSessionDto.checkpointId,
          mode: expectedMode,
          status: StaffSessionStatus.ACTIVE,
          startedAt: now,
          lastSeenAt: now,
          metadata:
            startStaffSessionDto.metadata === undefined
              ? Prisma.JsonNull
              : (startStaffSessionDto.metadata as Prisma.InputJsonValue),
        },
        include: this.staffSessionInclude,
      });

      await tx.device.update({
        where: {
          id: startStaffSessionDto.deviceId,
        },
        data: {
          lastSeenAt: now,
        },
      });

      return staffSession;
    });
  }

  async startMySession(currentUser: AuthUser) {
    if (currentUser.role !== UserRole.STAFF) {
      throw new ForbiddenException(
        'Only STAFF can start their own scanner session',
      );
    }

    await this.ensureStaffUser(currentUser.id);

    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId: currentUser.id,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        event: true,
        checkpoint: true,
        device: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    if (!assignment.checkpointId || !assignment.checkpoint) {
      throw new BadRequestException(
        'Active staff assignment must include checkpointId',
      );
    }

    if (!assignment.deviceId || !assignment.device) {
      throw new BadRequestException(
        'Active staff assignment must include deviceId',
      );
    }

    if (!assignment.checkpoint.isActive) {
      throw new BadRequestException('Assigned checkpoint must be active');
    }

    if (assignment.device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Assigned device must be ACTIVE');
    }

    const staffSession = await this.start(currentUser, {
      eventId: assignment.eventId,
      staffUserId: currentUser.id,
      checkpointId: assignment.checkpointId,
      deviceId: assignment.deviceId,
      mode: this.resolveModeForCheckpoint(assignment.checkpoint.type),
      metadata: {
        source: 'START_MY_SESSION',
        assignmentId: assignment.id,
      },
    });

    return this.toSafeSessionResponse(staffSession);
  }

  async endMySession(currentUser: AuthUser) {
    if (currentUser.role !== UserRole.STAFF) {
      throw new ForbiddenException(
        'Only STAFF can end their own scanner session',
      );
    }

    const now = new Date();

    const activeSessions = await this.prisma.staffSession.findMany({
      where: {
        staffUserId: currentUser.id,
        status: StaffSessionStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });

    if (activeSessions.length === 0) {
      return {
        ended: true,
        endedCount: 0,
        message: 'No active staff session found',
      };
    }

    const result = await this.prisma.staffSession.updateMany({
      where: {
        id: {
          in: activeSessions.map((session) => session.id),
        },
        status: StaffSessionStatus.ACTIVE,
      },
      data: {
        status: StaffSessionStatus.ENDED,
        endedAt: now,
      },
    });

    return {
      ended: true,
      endedCount: result.count,
      endedAt: now,
    };
  }

  async findAll(query: ListStaffSessionsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);

    const where: Prisma.StaffSessionWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.staffUserId
        ? {
            staffUserId: query.staffUserId,
          }
        : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.checkpointId
        ? {
            checkpointId: query.checkpointId,
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          startedAt: 'desc',
        },
        include: this.staffSessionInclude,
      }),

      this.prisma.staffSession.count({
        where,
      }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const staffSession = await this.prisma.staffSession.findUnique({
      where: {
        id,
      },
      include: this.staffSessionInclude,
    });

    if (!staffSession) {
      throw new NotFoundException('Staff session not found');
    }

    return staffSession;
  }

  async end(id: string) {
    const staffSession = await this.findOne(id);

    if (staffSession.status === StaffSessionStatus.ENDED) {
      return staffSession;
    }

    return this.prisma.staffSession.update({
      where: {
        id,
      },
      data: {
        status: StaffSessionStatus.ENDED,
        endedAt: new Date(),
      },
      include: this.staffSessionInclude,
    });
  }

  async remove(id: string) {
    const staffSession = await this.end(id);

    return {
      ended: true,
      staffSession,
    };
  }

  private resolveStaffUserId(currentUser: AuthUser, staffUserId?: string) {
    if (currentUser.role === UserRole.STAFF) {
      if (staffUserId && staffUserId !== currentUser.id) {
        throw new ForbiddenException(
          'STAFF cannot start a session for another user',
        );
      }

      return currentUser.id;
    }

    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (!staffUserId) {
        throw new BadRequestException(
          'staffUserId is required for SUPER_ADMIN',
        );
      }

      return staffUserId;
    }

    throw new ForbiddenException(
      'Only STAFF or SUPER_ADMIN can start sessions',
    );
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

  private async ensureActiveAssignmentBinding(input: {
    eventId: string;
    staffUserId: string;
    deviceId: string;
    checkpointId: string;
  }) {
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: {
        eventId_userId: {
          eventId: input.eventId,
          userId: input.staffUserId,
        },
      },
    });

    if (!assignment || !assignment.isActive) {
      throw new BadRequestException(
        'Staff user must have an active assignment for this event',
      );
    }

    if (!assignment.deviceId) {
      throw new BadRequestException(
        'Staff assignment does not include a device',
      );
    }

    if (!assignment.checkpointId) {
      throw new BadRequestException(
        'Staff assignment does not include a checkpoint',
      );
    }

    if (assignment.deviceId !== input.deviceId) {
      throw new BadRequestException(
        'Session device must match the staff assignment device',
      );
    }

    if (assignment.checkpointId !== input.checkpointId) {
      throw new BadRequestException(
        'Session checkpoint must match the staff assignment checkpoint',
      );
    }

    return assignment;
  }

  private async ensureActiveDeviceBelongsToEvent(
    deviceId: string,
    eventId: string,
  ) {
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

  private async ensureActiveCheckpointBelongsToEvent(
    checkpointId: string,
    eventId: string,
  ): Promise<Checkpoint> {
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

  private resolveModeForCheckpoint(type: CheckpointType) {
    if (type === CheckpointType.ENTRY) {
      return StaffScanMode.ENTRY;
    }

    if (type === CheckpointType.EXIT) {
      return StaffScanMode.EXIT;
    }

    if (type === CheckpointType.BOOTH) {
      return StaffScanMode.BOOTH_VISIT;
    }

    if (type === CheckpointType.SESSION_ROOM) {
      return StaffScanMode.SESSION_ATTENDANCE;
    }

    if (type === CheckpointType.VIP_AREA) {
      return StaffScanMode.VIP_ACCESS;
    }

    return StaffScanMode.CHECKPOINT;
  }

  private toSafeSessionResponse(staffSession: SafeStaffSessionPayload) {
    return {
      id: staffSession.id,
      eventId: staffSession.eventId,
      checkpointId: staffSession.checkpointId,
      deviceId: staffSession.deviceId,
      staffUserId: staffSession.staffUserId,
      mode: staffSession.mode,
      status: staffSession.status,
      startedAt: staffSession.startedAt,
      endedAt: staffSession.endedAt,
      lastSeenAt: staffSession.lastSeenAt,

      event: {
        id: staffSession.event.id,
        titleAr: staffSession.event.titleAr,
        titleEn: staffSession.event.titleEn,
      },

      checkpoint: {
        id: staffSession.checkpoint.id,
        nameAr: staffSession.checkpoint.nameAr,
        nameEn: staffSession.checkpoint.nameEn ?? null,
        code: staffSession.checkpoint.code,
        type: staffSession.checkpoint.type,
      },

      device: {
        id: staffSession.device.id,
        name: staffSession.device.name,
        code: staffSession.device.code,
      },
    };
  }

  private readonly staffSessionInclude = {
    event: {
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        status: true,
      },
    },

    staffUser: {
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    },

    device: {
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        lastSeenAt: true,
      },
    },

    checkpoint: {
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        code: true,
        type: true,
        isActive: true,
      },
    },
  } satisfies Prisma.StaffSessionInclude;
}
