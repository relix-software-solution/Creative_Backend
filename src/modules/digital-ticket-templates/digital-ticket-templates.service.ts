import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { safeDeleteUploadFile } from '../../common/utils/upload-file.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { BadgeTemplatesService } from '../badge-templates/badge-templates.service';
import {
  DigitalTicketTemplateFieldDto,
  UpsertDigitalTicketTemplateDto,
} from './dto/digital-ticket-template.dto';
import { ListDigitalTicketTemplatesQueryDto } from './dto/list-digital-ticket-templates-query.dto';

const EVENT_WIDE_SCOPE_KEY = '__EVENT__';
const TEMPLATE_UPLOAD_SUBDIR = 'digital-tickets/templates';

const TICKET_SYSTEM_FIELDS = [
  {
    key: 'eventName',
    labelAr: 'ط§ط³ظ… ط§ظ„ظپط¹ط§ظ„ظٹط©',
    labelEn: 'Event Name',
    source: 'SYSTEM',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'eventDate',
    labelAr: 'طھط§ط±ظٹط® ط§ظ„ظپط¹ط§ظ„ظٹط©',
    labelEn: 'Event Date',
    source: 'SYSTEM',
    type: 'DATE',
    required: false,
  },
  {
    key: 'venueName',
    labelAr: 'ط§ظ„ظ…ظƒط§ظ†',
    labelEn: 'Venue Name',
    source: 'SYSTEM',
    type: 'TEXT',
    required: false,
  },
];

@Injectable()
export class DigitalTicketTemplatesService {
  private readonly logger = new Logger(DigitalTicketTemplatesService.name);

  constructor(
    private readonly badgeTemplatesService: BadgeTemplatesService,
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: UpsertDigitalTicketTemplateDto) {
    if (!dto.eventId) {
      throw new BadRequestException('eventId is required');
    }

    await this.ensureEventExists(dto.eventId);
    await this.ensureAttendeeTypeBelongsToEvent(
      dto.eventId,
      dto.attendeeTypeId,
    );
    await this.ensureSelectedFieldsAreValid(dto.eventId, dto.selectedFields);

    const normalizedAttendeeTypeId = this.toNullableAttendeeTypeId(
      dto.attendeeTypeId,
    );
    const attendeeTypeScopeKey = this.toAttendeeTypeScopeKey(
      normalizedAttendeeTypeId,
    );
    const existing = await this.prisma.digitalTicketTemplate.findUnique({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId: dto.eventId,
          attendeeTypeScopeKey,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Digital ticket template already exists for this event and attendee type scope',
      );
    }

    return this.prisma.digitalTicketTemplate.create({
      data: {
        eventId: dto.eventId,
        attendeeTypeId: normalizedAttendeeTypeId,
        attendeeTypeScopeKey,
        name: this.requiredString(dto.name, 'name'),
        widthPx: this.requiredPositiveInt(dto.widthPx, 'widthPx'),
        heightPx: this.requiredPositiveInt(dto.heightPx, 'heightPx'),
        backgroundImageUrl: dto.backgroundImageUrl,
        backgroundImagePath: dto.backgroundImagePath,
        theme: this.toJsonObject(this.requiredJsonObject(dto.theme, 'theme')),
        elements: this.toJsonArray(this.requiredJsonArray(dto.elements, 'elements')),
        selectedFields: this.toJsonArray(dto.selectedFields ?? []),
      },
    });
  }

  async findAll(query: ListDigitalTicketTemplatesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.DigitalTicketTemplateWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId
        ? {
            attendeeTypeId:
              this.toNullableAttendeeTypeId(query.attendeeTypeId),
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.digitalTicketTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          event: { select: { id: true, titleAr: true, titleEn: true } },
          attendeeType: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
        },
      }),
      this.prisma.digitalTicketTemplate.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findByEvent(eventId: string) {
    await this.ensureEventExists(eventId);

    return this.prisma.digitalTicketTemplate.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ attendeeTypeId: 'asc' }, { createdAt: 'desc' }],
      include: {
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });
  }

  async findByEventAndAttendeeType(
    eventId: string,
    attendeeTypeId?: string | null,
  ) {
    await this.ensureEventExists(eventId);
    const attendeeTypeScopeKey = this.toAttendeeTypeScopeKey(attendeeTypeId);

    const template = await this.prisma.digitalTicketTemplate.findUnique({
      where: {
        eventId_attendeeTypeScopeKey: { eventId, attendeeTypeScopeKey },
      },
      include: {
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Digital ticket template not found');
    }

    return template;
  }

  async update(
    eventId: string,
    attendeeTypeId: string | null | undefined,
    dto: UpsertDigitalTicketTemplateDto,
  ) {
    await this.ensureEventExists(eventId);

    if (dto.eventId && dto.eventId !== eventId) {
      throw new BadRequestException('Body eventId must match route eventId');
    }

    const routeAttendeeTypeId = this.toNullableAttendeeTypeId(attendeeTypeId);

    if (
      dto.attendeeTypeId !== undefined &&
      this.toNullableAttendeeTypeId(dto.attendeeTypeId) !== routeAttendeeTypeId
    ) {
      throw new BadRequestException(
        'Body attendeeTypeId must match route attendeeTypeId',
      );
    }

    await this.ensureSelectedFieldsAreValid(eventId, dto.selectedFields);
    const existing = await this.findByEventAndAttendeeType(
      eventId,
      routeAttendeeTypeId,
    );
    const oldBackgroundPaths = this.uniquePaths([
      existing.backgroundImageUrl,
      existing.backgroundImagePath,
    ]);

    const updated = await this.prisma.digitalTicketTemplate.update({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId,
          attendeeTypeScopeKey: this.toAttendeeTypeScopeKey(routeAttendeeTypeId),
        },
      },
      data: {
        name: dto.name,
        widthPx: this.optionalPositiveInt(dto.widthPx, 'widthPx'),
        heightPx: this.optionalPositiveInt(dto.heightPx, 'heightPx'),
        backgroundImageUrl: dto.backgroundImageUrl,
        backgroundImagePath: dto.backgroundImagePath,
        theme:
          dto.theme === undefined
            ? undefined
            : this.toJsonObject(this.requiredJsonObject(dto.theme, 'theme')),
        elements:
          dto.elements === undefined
            ? undefined
            : this.toJsonArray(this.requiredJsonArray(dto.elements, 'elements')),
        selectedFields:
          dto.selectedFields === undefined
            ? undefined
            : this.toJsonArray(dto.selectedFields),
        version: { increment: 1 },
        isActive: true,
      },
    });

    if (
      (dto.backgroundImageUrl || dto.backgroundImagePath) &&
      oldBackgroundPaths.some(
        (path) =>
          path !== dto.backgroundImageUrl && path !== dto.backgroundImagePath,
      )
    ) {
      await Promise.all(
        oldBackgroundPaths.map((path) =>
          safeDeleteUploadFile(path, TEMPLATE_UPLOAD_SUBDIR, this.logger),
        ),
      );
    }

    return updated;
  }

  async remove(eventId: string, attendeeTypeId?: string | null) {
    const template = await this.findByEventAndAttendeeType(
      eventId,
      this.toNullableAttendeeTypeId(attendeeTypeId),
    );

    await this.prisma.digitalTicketTemplate.delete({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId,
          attendeeTypeScopeKey: template.attendeeTypeScopeKey,
        },
      },
    });
    await Promise.all(
      this.uniquePaths([
        template.backgroundImageUrl,
        template.backgroundImagePath,
      ]).map((path) =>
        safeDeleteUploadFile(path, TEMPLATE_UPLOAD_SUBDIR, this.logger),
      ),
    );

    return {
      deleted: true,
      eventId,
      attendeeTypeId: template.attendeeTypeId,
    };
  }

  async removeBackgroundImage(
    eventId: string,
    attendeeTypeId?: string | null,
  ) {
    const template = await this.findByEventAndAttendeeType(
      eventId,
      this.toNullableAttendeeTypeId(attendeeTypeId),
    );
    const oldBackgroundPaths = this.uniquePaths([
      template.backgroundImageUrl,
      template.backgroundImagePath,
    ]);

    if (oldBackgroundPaths.length === 0) {
      return {
        eventId,
        attendeeTypeId: template.attendeeTypeId,
        field: 'backgroundImageUrl',
        backgroundImageUrl: null,
        backgroundImagePath: null,
        version: template.version,
        removed: false,
        alreadyMissing: true,
        entity: template,
      };
    }

    const updated = await this.prisma.digitalTicketTemplate.update({
      where: {
        eventId_attendeeTypeScopeKey: {
          eventId,
          attendeeTypeScopeKey: template.attendeeTypeScopeKey,
        },
      },
      data: {
        backgroundImageUrl: null,
        backgroundImagePath: null,
        version: { increment: 1 },
      },
    });

    await Promise.all(
      oldBackgroundPaths.map((path) =>
        safeDeleteUploadFile(path, TEMPLATE_UPLOAD_SUBDIR, this.logger),
      ),
    );

    return {
      eventId,
      attendeeTypeId: updated.attendeeTypeId,
      field: 'backgroundImageUrl',
      backgroundImageUrl: null,
      backgroundImagePath: null,
      version: updated.version,
      removed: true,
      alreadyMissing: false,
      entity: updated,
    };
  }

  async availableFields(eventId: string) {
    const sharedFields =
      await this.badgeTemplatesService.getAvailableFieldDefinitions(eventId);
    const existingKeys = new Set(sharedFields.map((field) => field.key));

    return {
      fields: [
        ...sharedFields,
        ...TICKET_SYSTEM_FIELDS.filter((field) => !existingKeys.has(field.key)),
      ],
    };
  }

  async findActiveSummariesOrNull(eventId: string) {
    const templates = await this.prisma.digitalTicketTemplate.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ attendeeTypeId: 'asc' }, { createdAt: 'desc' }],
      select: {
        attendeeTypeId: true,
        name: true,
        version: true,
        isActive: true,
      },
    });

    return templates.length > 0 ? templates : null;
  }

  private async ensureEventExists(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }
  }

  private async ensureAttendeeTypeBelongsToEvent(
    eventId: string,
    attendeeTypeId?: string | null,
  ) {
    const normalized = this.toNullableAttendeeTypeId(attendeeTypeId);

    if (!normalized) {
      return;
    }

    const attendeeType = await this.prisma.attendeeType.findUnique({
      where: { id: normalized },
      select: { id: true, eventId: true },
    });

    if (!attendeeType) {
      throw new NotFoundException('Attendee type not found');
    }

    if (attendeeType.eventId !== eventId) {
      throw new BadRequestException(
        'Attendee type must belong to the same event',
      );
    }
  }

  private async ensureSelectedFieldsAreValid(
    eventId: string,
    selectedFields?: DigitalTicketTemplateFieldDto[],
  ) {
    if (selectedFields === undefined) {
      return;
    }

    if (!Array.isArray(selectedFields)) {
      throw new BadRequestException('selectedFields must be a JSON array');
    }

    const available = await this.availableFields(eventId);
    const allowedKeys = new Set(available.fields.map((field) => field.key));
    const unknown = selectedFields.find((field) => {
      return (
        typeof field !== 'object' ||
        field === null ||
        typeof field.key !== 'string' ||
        !allowedKeys.has(field.key)
      );
    });

    if (unknown) {
      throw new BadRequestException('selectedFields contains unknown keys');
    }
  }

  private toAttendeeTypeScopeKey(attendeeTypeId?: string | null) {
    return this.toNullableAttendeeTypeId(attendeeTypeId) ?? EVENT_WIDE_SCOPE_KEY;
  }

  private toNullableAttendeeTypeId(attendeeTypeId?: string | null) {
    if (
      attendeeTypeId === undefined ||
      attendeeTypeId === null ||
      attendeeTypeId === '' ||
      attendeeTypeId === EVENT_WIDE_SCOPE_KEY ||
      attendeeTypeId === 'event'
    ) {
      return null;
    }

    return attendeeTypeId;
  }

  private requiredString(value: string | undefined, field: string) {
    if (!value || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private requiredPositiveInt(value: number | undefined, field: string) {
    const parsed = this.optionalPositiveInt(value, field);

    if (parsed === undefined) {
      throw new BadRequestException(`${field} is required`);
    }

    return parsed;
  }

  private optionalPositiveInt(value: number | undefined, field: string) {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }

    return value;
  }

  private requiredJsonObject(
    value: Record<string, unknown> | undefined,
    field: string,
  ) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be a JSON object`);
    }

    return value;
  }

  private requiredJsonArray(value: unknown[] | undefined, field: string) {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${field} must be a JSON array`);
    }

    return value;
  }

  private toJsonObject(value: Record<string, unknown>) {
    return value as Prisma.InputJsonObject;
  }

  private toJsonArray(value: unknown[]) {
    return value as Prisma.InputJsonArray;
  }

  private uniquePaths(paths: Array<string | null | undefined>) {
    return Array.from(
      new Set(paths.filter((path): path is string => Boolean(path))),
    );
  }
}
