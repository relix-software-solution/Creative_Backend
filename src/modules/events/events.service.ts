import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { EventCleanupFilesRequestDto } from '../storage-cleanup/dto/storage-cleanup.dto';
import { StorageCleanupService } from '../storage-cleanup/storage-cleanup.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageCleanupService: StorageCleanupService,
  ) {}

  async create(createEventDto: CreateEventDto) {
    await this.ensureClientExists(createEventDto.clientId);

    const startsAt = new Date(createEventDto.startsAt);
    const endsAt = new Date(createEventDto.endsAt);
    this.ensureEndsAfterStarts(startsAt, endsAt);

    return this.prisma.event.create({
      data: {
        ...createEventDto,
        status: EventStatus.DRAFT,
        startsAt,
        endsAt,
        qrValidFrom: createEventDto.qrValidFrom
          ? new Date(createEventDto.qrValidFrom)
          : undefined,
        qrValidUntil: createEventDto.qrValidUntil
          ? new Date(createEventDto.qrValidUntil)
          : undefined,
      },
    });
  }

  async findAll(query: ListEventsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.EventWhereInput = {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { titleAr: { contains: query.search } },
              { titleEn: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.event.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async update(id: string, updateEventDto: UpdateEventDto) {
    const event = await this.findOne(id);

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }

    if (updateEventDto.clientId) {
      await this.ensureClientExists(updateEventDto.clientId);
    }

    const startsAt = updateEventDto.startsAt
      ? new Date(updateEventDto.startsAt)
      : event.startsAt;
    const endsAt = updateEventDto.endsAt
      ? new Date(updateEventDto.endsAt)
      : event.endsAt;
    this.ensureEndsAfterStarts(startsAt, endsAt);

    return this.prisma.event.update({
      where: { id },
      data: {
        ...updateEventDto,
        startsAt: updateEventDto.startsAt ? startsAt : undefined,
        endsAt: updateEventDto.endsAt ? endsAt : undefined,
        qrValidFrom: updateEventDto.qrValidFrom
          ? new Date(updateEventDto.qrValidFrom)
          : undefined,
        qrValidUntil: updateEventDto.qrValidUntil
          ? new Date(updateEventDto.qrValidUntil)
          : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    const cleanupManifest =
      await this.storageCleanupService.findEventOwnedFiles(id);

    const summary = await this.prisma.$transaction(async (tx) => {
      const offlineScanOperations = await tx.offlineScanOperation.deleteMany({
        where: { eventId: id },
      });
      const offlineRegistrationMappings =
        await tx.offlineRegistrationMapping.deleteMany({
          where: { eventId: id },
        });
      const notificationLogs = await tx.notificationLog.deleteMany({
        where: {
          OR: [
            { eventId: id },
            { registration: { eventId: id } },
            { template: { eventId: id } },
          ],
        },
      });
      const movementLogs = await tx.movementLog.deleteMany({
        where: { eventId: id },
      });
      const scanEvents = await tx.scanEventRaw.deleteMany({
        where: { eventId: id },
      });
      const qrTokens = await tx.qrToken.deleteMany({
        where: { eventId: id },
      });

      await tx.syncOperation.deleteMany({
        where: { syncBatch: { eventId: id } },
      });
      await tx.syncBatch.deleteMany({ where: { eventId: id } });
      await tx.importRow.deleteMany({
        where: {
          OR: [
            { importJob: { eventId: id } },
            { registration: { eventId: id } },
          ],
        },
      });
      await tx.importJob.deleteMany({ where: { eventId: id } });
      const digitalTicketImages = await tx.digitalTicketImage.deleteMany({
        where: { eventId: id },
      });

      const staffSessions = await tx.staffSession.deleteMany({
        where: { eventId: id },
      });
      const staffAssignments = await tx.staffAssignment.deleteMany({
        where: { eventId: id },
      });
      const deviceOfflineKeys = await tx.deviceOfflineKey.deleteMany({
        where: { device: { eventId: id } },
      });
      const devices = await tx.device.deleteMany({ where: { eventId: id } });
      const checkpoints = await tx.checkpoint.deleteMany({
        where: { eventId: id },
      });

      await tx.zone.updateMany({
        where: { eventId: id },
        data: { parentId: null },
      });
      const zones = await tx.zone.deleteMany({ where: { eventId: id } });
      const venues = await tx.venue.deleteMany({ where: { eventId: id } });
      const registrationFields = await tx.registrationField.deleteMany({
        where: { eventId: id },
      });
      const registrations = await tx.registration.deleteMany({
        where: { eventId: id },
      });
      const digitalTicketTemplates =
        await tx.digitalTicketTemplate.deleteMany({
          where: { eventId: id },
        });
      const attendeeTypes = await tx.attendeeType.deleteMany({
        where: { eventId: id },
      });
      const branding = await tx.eventBranding.deleteMany({
        where: { eventId: id },
      });
      const badgeTemplates = await tx.eventBadgeTemplate.deleteMany({
        where: { eventId: id },
      });

      await tx.notificationTemplate.deleteMany({ where: { eventId: id } });
      await tx.event.delete({ where: { id } });

      return {
        offlineScanOperations: offlineScanOperations.count,
        offlineRegistrationMappings: offlineRegistrationMappings.count,
        deviceOfflineKeys: deviceOfflineKeys.count,
        digitalTicketImages: digitalTicketImages.count,
        registrations: registrations.count,
        qrTokens: qrTokens.count,
        notificationLogs: notificationLogs.count,
        scanEvents: scanEvents.count,
        movementLogs: movementLogs.count,
        staffSessions: staffSessions.count,
        staffAssignments: staffAssignments.count,
        devices: devices.count,
        checkpoints: checkpoints.count,
        zones: zones.count,
        venues: venues.count,
        registrationFields: registrationFields.count,
        attendeeTypes: attendeeTypes.count,
        branding: branding.count,
        badgeTemplates: badgeTemplates.count,
        digitalTicketTemplates: digitalTicketTemplates.count,
      };
    });

    const storageCleanup = await this.storageCleanupService.enqueueEventCleanup(
      {
        eventId: id,
        relativePaths: cleanupManifest,
      },
    );

    return { deleted: true, eventId: id, summary, storageCleanup };
  }

  async cleanupFiles(
    eventId: string,
    dto: EventCleanupFilesRequestDto,
    requestedByUserId: string,
  ) {
    await this.findOne(eventId);

    if (dto.dryRun !== false) {
      return this.storageCleanupService.previewEventCleanup(eventId);
    }

    const relativePaths =
      await this.storageCleanupService.findEventOwnedFiles(eventId);

    return this.storageCleanupService.enqueueEventCleanup({
      eventId,
      relativePaths,
      requestedByUserId,
    });
  }

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  private ensureEndsAfterStarts(startsAt: Date, endsAt: Date) {
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }
}
