import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceStatus,
  EventStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import type { ProvisionOfflineKeyDto } from '../devices/dto/provision-offline-key.dto';
import { OfflineQrService } from '../offline/offline-qr.service';

@Injectable()
export class StaffOfflineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offlineQrService: OfflineQrService,
  ) {}

  async provisionMyAssignedDeviceKey(
    currentUser: AuthUser,
    dto: ProvisionOfflineKeyDto,
    rotateExisting = false,
  ) {
    if (currentUser.role !== UserRole.STAFF) {
      throw new ForbiddenException(
        'Only STAFF can provision its assigned device',
      );
    }

    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId: currentUser.id,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            deletedAt: true,
          },
        },
        event: {
          select: {
            id: true,
            status: true,
            isActive: true,
          },
        },
        device: {
          select: {
            id: true,
            eventId: true,
            status: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    if (
      assignment.user.role !== UserRole.STAFF ||
      assignment.user.status !== UserStatus.ACTIVE ||
      assignment.user.deletedAt
    ) {
      throw new ForbiddenException('Staff user is not active');
    }

    if (!assignment.event.isActive) {
      throw new BadRequestException('Assigned event is not active');
    }

    if (
      assignment.event.status === EventStatus.CANCELLED ||
      assignment.event.status === EventStatus.COMPLETED ||
      assignment.event.status === EventStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        'Offline registration keys cannot be provisioned for this event',
      );
    }

    if (!assignment.deviceId || !assignment.device) {
      throw new BadRequestException(
        'Active staff assignment must include a device',
      );
    }

    if (assignment.device.eventId !== assignment.eventId) {
      throw new ForbiddenException(
        'Assigned device does not belong to the assigned event',
      );
    }

    if (assignment.device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Assigned device must be ACTIVE');
    }

    const key = await this.offlineQrService.provisionDevicePublicKey({
      deviceId: assignment.device.id,
      publicKey: dto.publicKey,
      keyVersion: dto.keyVersion,
      rotateExisting,
    });

    return {
      deviceId: assignment.device.id,
      eventId: assignment.eventId,
      keyVersion: key.version,
      status: key.status,
      validFrom: key.validFrom,
      validUntil: key.validUntil,
    };
  }
}
