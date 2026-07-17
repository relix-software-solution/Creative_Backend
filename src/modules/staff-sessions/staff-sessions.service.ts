import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckpointType,
  DeviceStatus,
  EventStatus,
  Prisma,
  StaffScanMode,
  StaffSessionStatus,
  UserRole,
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
  status: StaffSessionStatus;
  event: {
    id: string;
    titleAr: string;
    titleEn: string | null;
  };
  checkpoint: {
    id: string;
    nameAr: string;
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

  async start(currentUser: AuthUser, startStaffSessionDto: StartStaffSessionDto) {
    const staffUserId = this.resolveStaffUserId(
      currentUser,
      startStaffSessionDto.staffUserId,
    );
    const now = new Date();

    await this.ensureEventCanBeModified(startStaffSessionDto.eventId);
    await this.ensureStaffUser(staffUserId);
    await this.ensureActiveAssignment(startStaffSessionDto.eventId, staffUserId);
    await this.ensureActiveDeviceBelongsToEvent(
      startStaffSessionDto.deviceId,
      startStaffSessionDto.eventId,
    );
    await this.ensureActiveCheckpointBelongsToEvent(
      startStaffSessionDto.checkpointId,
      startStaffSessionDto.eventId,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.staffSession.updateMany({
        where: {
          eventId: startStaffSessionDto.eventId,
          staffUserId,
          status: StaffSessionStatus.ACTIVE,
        },
        data: {
          status: StaffSessionStatus.ENDED,
          endedAt: now,
        },
      });
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
          mode: startStaffSessionDto.mode,
          status: StaffSessionStatus.ACTIVE,
          lastSeenAt: now,
          metadata:
            startStaffSessionDto.metadata === undefined
              ? Prisma.JsonNull
              : (startStaffSessionDto.metadata as Prisma.InputJsonValue),
        },
        include: this.staffSessionInclude,
      });

      await tx.device.update({
        where: { id: startStaffSessionDto.deviceId },
        data: { lastSeenAt: now },
      });

      return staffSession;
    });
  }

  async startMySession(currentUser: AuthUser) {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId: currentUser.id,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        checkpoint: true,
        device: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    if (!assignment.checkpointId || !assignment.deviceId) {
      throw new BadRequestException(
        'Active staff assignment must include checkpointId and deviceId',
      );
    }

    if (!assignment.checkpoint) {
      throw new NotFoundException('Checkpoint not found');
    }

    if (!assignment.device) {
      throw new NotFoundException('Device not found');
    }

    const staffSession = await this.start(currentUser, {
      eventId: assignment.eventId,
      staffUserId: currentUser.id,
      checkpointId: assignment.checkpointId,
      deviceId: assignment.deviceId,
      mode: this.resolveModeForCheckpoint(assignment.checkpoint.type),
    });

    return this.toSafeSessionResponse(staffSession);
  }

  async findAll(query: ListStaffSessionsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.StaffSessionWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.staffUserId ? { staffUserId: query.staffUserId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.checkpointId ? { checkpointId: query.checkpointId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: this.staffSessionInclude,
      }),
      this.prisma.staffSession.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const staffSession = await this.prisma.staffSession.findUnique({
      where: { id },
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
      where: { id },
      data: {
        status: StaffSessionStatus.ENDED,
        endedAt: new Date(),
      },
      include: this.staffSessionInclude,
    });
  }

  async remove(id: string) {
    const staffSession = await this.end(id);

    return { ended: true, staffSession };
  }

  private resolveStaffUserId(currentUser: AuthUser, staffUserId?: string) {
    if (currentUser.role === UserRole.STAFF) {
      if (staffUserId && staffUserId !== currentUser.id) {
        throw new ForbiddenException('staffUserId is only allowed for SUPER_ADMIN');
      }

      return currentUser.id;
    }

    if (currentUser.role === UserRole.SUPER_ADMIN) {
      if (!staffUserId) {
        throw new BadRequestException('staffUserId is required for SUPER_ADMIN');
      }

      return staffUserId;
    }

    throw new ForbiddenException('Only STAFF or SUPER_ADMIN can start sessions');
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

  private async ensureActiveAssignment(eventId: string, userId: string) {
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (!assignment || !assignment.isActive) {
      throw new BadRequestException(
        'Staff user must have an active assignment for this event',
      );
    }
  }

  private async ensureActiveDeviceBelongsToEvent(
    deviceId: string,
    eventId: string,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
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
  }

  private async ensureActiveCheckpointBelongsToEvent(
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

    if (!checkpoint.isActive) {
      throw new BadRequestException('Checkpoint must be active');
    }
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
      status: staffSession.status,
      event: {
        id: staffSession.event.id,
        titleAr: staffSession.event.titleAr,
        titleEn: staffSession.event.titleEn,
      },
      checkpoint: {
        id: staffSession.checkpoint.id,
        nameAr: staffSession.checkpoint.nameAr,
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
      select: { id: true, titleAr: true, titleEn: true, status: true },
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
