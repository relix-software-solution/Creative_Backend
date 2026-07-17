import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, RegistrationFieldType } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateRegistrationFieldDto } from './dto/create-registration-field.dto';
import { ListRegistrationFieldsQueryDto } from './dto/list-registration-fields-query.dto';
import { UpdateRegistrationFieldDto } from './dto/update-registration-field.dto';

@Injectable()
export class RegistrationFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRegistrationFieldDto: CreateRegistrationFieldDto) {
    await this.ensureEventCanBeModified(createRegistrationFieldDto.eventId);
    await this.ensureAttendeeTypeBelongsToEvent(
      createRegistrationFieldDto.attendeeTypeId,
      createRegistrationFieldDto.eventId,
    );

    const key = this.normalizeKey(createRegistrationFieldDto.key);
    await this.ensureKeyIsUnique(
      createRegistrationFieldDto.eventId,
      key,
      createRegistrationFieldDto.attendeeTypeId,
    );

    const options = this.normalizeOptions(
      createRegistrationFieldDto.type,
      createRegistrationFieldDto.options,
    );

    return this.prisma.registrationField.create({
      data: {
        ...createRegistrationFieldDto,
        key,
        options,
        validation:
          createRegistrationFieldDto.validation === undefined
            ? Prisma.JsonNull
            : (createRegistrationFieldDto.validation as Prisma.InputJsonValue),
      },
    });
  }

  async findAll(query: ListRegistrationFieldsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.RegistrationFieldWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId ? { attendeeTypeId: query.attendeeTypeId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { key: { contains: query.search } },
              { labelAr: { contains: query.search } },
              { labelEn: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.registrationField.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.registrationField.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const registrationField = await this.prisma.registrationField.findUnique({
      where: { id },
    });

    if (!registrationField) {
      throw new NotFoundException('Registration field not found');
    }

    return registrationField;
  }

  async update(id: string, updateRegistrationFieldDto: UpdateRegistrationFieldDto) {
    const registrationField = await this.findOne(id);
    await this.ensureEventCanBeModified(registrationField.eventId);

    const attendeeTypeId =
      updateRegistrationFieldDto.attendeeTypeId === undefined
        ? registrationField.attendeeTypeId
        : updateRegistrationFieldDto.attendeeTypeId;
    await this.ensureAttendeeTypeBelongsToEvent(
      attendeeTypeId ?? undefined,
      registrationField.eventId,
    );

    const key = updateRegistrationFieldDto.key
      ? this.normalizeKey(updateRegistrationFieldDto.key)
      : registrationField.key;
    await this.ensureKeyIsUnique(
      registrationField.eventId,
      key,
      attendeeTypeId ?? undefined,
      id,
    );

    const type = updateRegistrationFieldDto.type ?? registrationField.type;
    const options =
      updateRegistrationFieldDto.options === undefined
        ? this.normalizeExistingOptions(type, registrationField.options)
        : this.normalizeOptions(type, updateRegistrationFieldDto.options);

    return this.prisma.registrationField.update({
      where: { id },
      data: {
        ...updateRegistrationFieldDto,
        attendeeTypeId,
        key,
        options,
        validation:
          updateRegistrationFieldDto.validation === undefined
            ? undefined
            : (updateRegistrationFieldDto.validation as Prisma.InputJsonValue),
      },
    });
  }

  async remove(id: string) {
    const registrationField = await this.findOne(id);
    await this.ensureEventCanBeModified(registrationField.eventId);

    await this.prisma.registrationField.delete({ where: { id } });

    return {
      success: true,
      deleted: true,
      id,
      eventId: registrationField.eventId,
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

  private async ensureAttendeeTypeBelongsToEvent(
    attendeeTypeId: string | undefined,
    eventId: string,
  ) {
    if (!attendeeTypeId) {
      return;
    }

    const attendeeType = await this.prisma.attendeeType.findUnique({
      where: { id: attendeeTypeId },
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

  private async ensureKeyIsUnique(
    eventId: string,
    key: string,
    attendeeTypeId?: string,
    excludeId?: string,
  ) {
    const existingRegistrationField =
      await this.prisma.registrationField.findFirst({
        where: {
          eventId,
          key,
          attendeeTypeId: attendeeTypeId ?? null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });

    if (existingRegistrationField) {
      throw new ConflictException(
        'Registration field key already exists for this event and attendee type scope',
      );
    }
  }

  private normalizeKey(key: string) {
    return key
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  private normalizeOptions(type: RegistrationFieldType, options: unknown) {
    if (!this.requiresOptions(type)) {
      return Prisma.JsonNull;
    }

    if (!this.hasNonEmptyOptions(options)) {
      throw new BadRequestException(
        'options must be provided for select fields',
      );
    }

    return options as Prisma.InputJsonValue;
  }

  private normalizeExistingOptions(
    type: RegistrationFieldType,
    options: Prisma.JsonValue,
  ) {
    if (!this.requiresOptions(type)) {
      return Prisma.JsonNull;
    }

    if (!this.hasNonEmptyOptions(options)) {
      throw new BadRequestException(
        'options must be provided for select fields',
      );
    }

    return options as Prisma.InputJsonValue;
  }

  private requiresOptions(type: RegistrationFieldType) {
    return (
      type === RegistrationFieldType.SELECT ||
      type === RegistrationFieldType.MULTI_SELECT
    );
  }

  private hasNonEmptyOptions(options: unknown) {
    if (Array.isArray(options)) {
      return options.length > 0;
    }

    return (
      typeof options === 'object' &&
      options !== null &&
      Object.keys(options).length > 0
    );
  }
}
