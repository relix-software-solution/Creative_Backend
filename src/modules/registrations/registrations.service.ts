import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AttendeeType,
  Event,
  EventStatus,
  Prisma,
  QrTokenStatus,
  Registration,
  RegistrationField,
  RegistrationFieldType,
  RegistrationSource,
  RegistrationStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';

type RegistrationInput = Pick<
  Registration,
  'eventId' | 'attendeeTypeId' | 'phone' | 'email' | 'externalId'
>;

type NormalizedCreateRegistrationDto = Omit<
  CreateRegistrationDto,
  'fullName' | 'phone' | 'email'
> & {
  fullName: string;
  phone: string;
  email: string | null;
};

type NormalizedUpdateRegistrationDto = Omit<
  UpdateRegistrationDto,
  'fullName' | 'phone' | 'email'
> & {
  fullName?: string;
  phone?: string;
  email?: string | null;
};

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.REGISTRATION_PIPELINE)
    private readonly registrationPipelineQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async create(createRegistrationDto: CreateRegistrationDto) {
    const dto = this.normalizeCreateDto(createRegistrationDto);

    const event = await this.ensureEventCanBeModified(dto.eventId);

    await this.ensureAttendeeTypeCanBeUsed(dto.attendeeTypeId, dto.eventId);

    const registrationInput: RegistrationInput = {
      eventId: dto.eventId,
      attendeeTypeId: dto.attendeeTypeId,
      phone: dto.phone,
      email: dto.email,
      externalId: dto.externalId ?? null,
    };

    /**
     * بما أن phone مطلوب ويوجد Unique Constraint على:
     *
     * eventId + phone
     *
     * نبحث أولًا عن تسجيل مؤرشف بنفس الهاتف والفعالية.
     * إذا وجدناه، نعيد استخدام نفس السجل بدل إنشاء سجل جديد.
     */
    const archivedRegistration = await this.findArchivedRegistrationByPhone(
      dto.eventId,
      dto.phone,
    );

    if (archivedRegistration) {
      /**
       * نستثني السجل الذي سنعيد تفعيله،
       * لكن نتحقق من عدم تعارض البريد أو externalId
       * مع تسجيل آخر.
       */
      await this.ensureDuplicateAllowed(
        event,
        registrationInput,
        archivedRegistration.id,
      );

      await this.validateCustomFields(
        dto.eventId,
        dto.attendeeTypeId,
        dto.customFields ?? {},
      );

      const restoredRegistration = await this.restoreArchivedRegistration(
        archivedRegistration.id,
        dto,
      );

      void this.enqueueRegistrationPipeline(
        restoredRegistration.id,
        restoredRegistration.eventId,
        restoredRegistration.source,
      );

      return restoredRegistration;
    }

    await this.ensureDuplicateAllowed(event, registrationInput);

    await this.validateCustomFields(
      dto.eventId,
      dto.attendeeTypeId,
      dto.customFields ?? {},
    );

    const registration = await this.createRegistrationOrThrowConflict(dto);

    void this.enqueueRegistrationPipeline(
      registration.id,
      registration.eventId,
      registration.source,
    );

    return registration;
  }

  async findAll(query: ListRegistrationsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.RegistrationWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.attendeeTypeId ? { attendeeTypeId: query.attendeeTypeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search } },
              { phone: { contains: query.search } },
              { email: { contains: query.search } },
              { companyName: { contains: query.search } },
              { externalId: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.registration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { registeredAt: 'desc' },
        include: this.registrationInclude,
      }),
      this.prisma.registration.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: this.registrationInclude,
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  async update(id: string, updateRegistrationDto: UpdateRegistrationDto) {
    const dto = this.normalizeUpdateDto(updateRegistrationDto);
    const registration = await this.findRegistrationOrThrow(id);
    const event = await this.ensureEventCanBeModified(registration.eventId);
    const attendeeTypeId = dto.attendeeTypeId ?? registration.attendeeTypeId;

    if (dto.attendeeTypeId) {
      await this.ensureAttendeeTypeCanBeUsed(
        attendeeTypeId,
        registration.eventId,
      );
    }

    const nextRegistration = {
      eventId: registration.eventId,
      attendeeTypeId,
      phone: dto.phone === undefined ? registration.phone : dto.phone,
      email: dto.email === undefined ? registration.email : dto.email,
      externalId:
        dto.externalId === undefined ? registration.externalId : dto.externalId,
    };
    await this.ensureDuplicateAllowed(event, nextRegistration, id);

    const customFields =
      dto.customFields === undefined
        ? this.toRecord(registration.customFields)
        : dto.customFields;
    await this.validateCustomFields(
      registration.eventId,
      attendeeTypeId,
      customFields,
    );

    try {
      return await this.prisma.registration.update({
        where: { id },
        data: {
          ...dto,
          attendeeTypeId,
          customFields:
            dto.customFields === undefined
              ? undefined
              : (dto.customFields as Prisma.InputJsonValue),
        },
        include: this.registrationInclude,
      });
    } catch (error) {
      this.throwConflictForUniqueConstraint(error);
      throw error;
    }
  }

  async cancel(id: string) {
    return this.setStatus(id, RegistrationStatus.CANCELLED);
  }

  async block(id: string) {
    return this.setStatus(id, RegistrationStatus.BLOCKED);
  }

  async activate(id: string) {
    return this.setStatus(id, RegistrationStatus.ACTIVE);
  }

  async remove(id: string) {
    const registration = await this.findRegistrationOrThrow(id);

    await this.ensureEventCanBeModified(registration.eventId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.qrToken.updateMany({
        where: {
          registrationId: id,
          status: QrTokenStatus.ACTIVE,
        },
        data: {
          status: QrTokenStatus.REVOKED,
          revokedAt: now,
        },
      });

      const archivedRegistration = await tx.registration.update({
        where: { id },
        data: {
          status: RegistrationStatus.ARCHIVED,

          /**
           * إبطال أي رابط أو Token قديم متعلق
           * بطلب البطاقة.
           */
          ticketRequestToken: null,
          ticketRequestExpiresAt: null,
          ticketRequestCreatedAt: null,
          ticketRequestConsumedAt: null,
        },
        include: this.registrationInclude,
      });

      return {
        archived: true,
        qrRevoked: true,
        registration: archivedRegistration,
      };
    });
  }

  private async setStatus(id: string, status: RegistrationStatus) {
    const registration = await this.findRegistrationOrThrow(id);
    await this.ensureEventCanBeModified(registration.eventId);

    return this.prisma.registration.update({
      where: { id },
      data: { status },
      include: this.registrationInclude,
    });
  }

  private async ensureEventCanBeModified(eventId: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }

    return event;
  }

  private async ensureAttendeeTypeCanBeUsed(
    attendeeTypeId: string,
    eventId: string,
  ): Promise<AttendeeType> {
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

    if (!attendeeType.isActive) {
      throw new BadRequestException('Attendee type must be active');
    }

    return attendeeType;
  }

  private async ensureDuplicateAllowed(
    event: Event,
    registration: RegistrationInput,
    excludeId?: string,
  ) {
    const duplicateStrategy = event.duplicateStrategy.toUpperCase();
    const duplicateChecks: Prisma.RegistrationWhereInput[] = [];

    if (
      duplicateStrategy === 'PHONE' ||
      duplicateStrategy === 'PHONE_OR_EMAIL'
    ) {
      if (registration.phone) {
        duplicateChecks.push({ phone: registration.phone });
      }
    }

    if (
      duplicateStrategy === 'EMAIL' ||
      duplicateStrategy === 'PHONE_OR_EMAIL'
    ) {
      if (registration.email) {
        duplicateChecks.push({ email: registration.email });
      }
    }

    if (duplicateStrategy === 'EXTERNAL_ID' && registration.externalId) {
      duplicateChecks.push({ externalId: registration.externalId });
    }

    if (duplicateStrategy === 'NONE' || duplicateChecks.length === 0) {
      return;
    }

    const existingRegistration = await this.prisma.registration.findFirst({
      where: {
        eventId: registration.eventId,
        OR: duplicateChecks,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingRegistration) {
      throw new ConflictException('Duplicate registration for this event');
    }
  }

  private findArchivedRegistrationByPhone(eventId: string, phone: string) {
    return this.prisma.registration.findFirst({
      where: {
        eventId,
        phone,
        status: RegistrationStatus.ARCHIVED,
      },
      select: {
        id: true,
        eventId: true,
        phone: true,
        status: true,
      },
    });
  }

  private async restoreArchivedRegistration(
    registrationId: string,
    dto: NormalizedCreateRegistrationDto,
  ) {
    const now = new Date();
    const publicId = await this.generatePublicId();

    try {
      return await this.prisma.$transaction(async (tx) => {
        /**
         * إجراء احتياطي:
         * لو بقي QR فعالًا لسبب ما، يتم إلغاؤه.
         */
        await tx.qrToken.updateMany({
          where: {
            registrationId,
            status: QrTokenStatus.ACTIVE,
          },
          data: {
            status: QrTokenStatus.REVOKED,
            revokedAt: now,
          },
        });

        /**
         * updateMany مع status=ARCHIVED يمنع طلبين
         * متزامنين من إعادة تفعيل السجل نفسه.
         *
         * أول طلب يحوله إلى ACTIVE.
         * الطلب الثاني سيحصل على count = 0.
         */
        const restoreResult = await tx.registration.updateMany({
          where: {
            id: registrationId,
            status: RegistrationStatus.ARCHIVED,
          },
          data: {
            ...dto,

            /**
             * نعطي التسجيل Public ID جديدًا حتى
             * لا تعمل روابط WhatsApp أو رموز التسجيل
             * العامة القديمة بعد إعادة التسجيل.
             */
            publicId,

            status: RegistrationStatus.ACTIVE,
            registeredAt: now,

            /**
             * سيقوم PublicService بإنشاء طلب
             * WhatsApp جديد بعد توليد البطاقة.
             */
            ticketRequestToken: null,
            ticketRequestExpiresAt: null,
            ticketRequestCreatedAt: null,
            ticketRequestConsumedAt: null,

            customFields:
              dto.customFields === undefined
                ? Prisma.JsonNull
                : (dto.customFields as Prisma.InputJsonValue),
          },
        });

        if (restoreResult.count !== 1) {
          throw new ConflictException('Registration is no longer archived');
        }

        const restoredRegistration = await tx.registration.findUnique({
          where: {
            id: registrationId,
          },
        });

        if (!restoredRegistration) {
          throw new NotFoundException(
            'Registration not found after restoration',
          );
        }

        return restoredRegistration;
      });
    } catch (error) {
      this.throwConflictForUniqueConstraint(error);
      throw error;
    }
  }

  private async createRegistrationOrThrowConflict(
    dto: NormalizedCreateRegistrationDto,
  ) {
    try {
      return await this.prisma.registration.create({
        data: {
          ...dto,
          publicId: await this.generatePublicId(),
          customFields:
            dto.customFields === undefined
              ? Prisma.JsonNull
              : (dto.customFields as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.throwConflictForUniqueConstraint(error);
      throw error;
    }
  }

  private normalizeCreateDto(
    dto: CreateRegistrationDto,
  ): NormalizedCreateRegistrationDto {
    const fullName = this.normalizeRequiredString(dto.fullName, 'fullName');
    const phone = this.normalizeRequiredString(dto.phone, 'phone');

    return {
      ...dto,
      fullName,
      phone,
      email: this.normalizeOptionalStringToNull(dto.email),
      companyName: this.normalizeOptionalString(dto.companyName),
      jobTitle: this.normalizeOptionalString(dto.jobTitle),
      externalId: this.normalizeOptionalString(dto.externalId),
      notes: this.normalizeOptionalString(dto.notes),
    };
  }

  private normalizeUpdateDto(
    dto: UpdateRegistrationDto,
  ): NormalizedUpdateRegistrationDto {
    return {
      ...dto,
      fullName:
        dto.fullName === undefined
          ? undefined
          : this.normalizeRequiredString(dto.fullName, 'fullName'),
      phone:
        dto.phone === undefined
          ? undefined
          : this.normalizeRequiredString(dto.phone, 'phone'),
      email:
        dto.email === undefined
          ? undefined
          : this.normalizeOptionalStringToNull(dto.email),
      companyName: this.normalizeOptionalString(dto.companyName),
      jobTitle: this.normalizeOptionalString(dto.jobTitle),
      externalId: this.normalizeOptionalString(dto.externalId),
      notes: this.normalizeOptionalString(dto.notes),
    };
  }

  private normalizeRequiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalString(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return value as string;
    }

    const trimmed = value.trim();

    return trimmed.length === 0 ? undefined : trimmed;
  }

  private normalizeOptionalStringToNull(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('email must be a valid email');
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return null;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('email must be a valid email');
    }

    return trimmed;
  }

  private throwConflictForUniqueConstraint(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Duplicate registration for this event');
    }
  }

  private async validateCustomFields(
    eventId: string,
    attendeeTypeId: string,
    customFields: Record<string, unknown>,
  ) {
    const fields = await this.prisma.registrationField.findMany({
      where: {
        eventId,
        isActive: true,
        OR: [{ attendeeTypeId: null }, { attendeeTypeId }],
      },
    });
    const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

    for (const key of Object.keys(customFields)) {
      if (!fieldsByKey.has(key)) {
        throw new BadRequestException(`Unknown custom field: ${key}`);
      }
    }

    for (const field of fields) {
      const value = customFields[field.key];

      if (field.isRequired && this.isEmpty(value)) {
        throw new BadRequestException(`${field.key} is required`);
      }

      if (this.isEmpty(value)) {
        continue;
      }

      this.validateCustomFieldValue(field, value);
    }
  }

  private validateCustomFieldValue(field: RegistrationField, value: unknown) {
    switch (field.type) {
      case RegistrationFieldType.EMAIL:
        if (
          typeof value !== 'string' ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ) {
          throw new BadRequestException(`${field.key} must be a valid email`);
        }
        break;
      case RegistrationFieldType.PHONE:
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new BadRequestException(`${field.key} must be a valid phone`);
        }
        break;
      case RegistrationFieldType.NUMBER:
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new BadRequestException(`${field.key} must be a number`);
        }
        break;
      case RegistrationFieldType.BOOLEAN:
        if (typeof value !== 'boolean') {
          throw new BadRequestException(`${field.key} must be a boolean`);
        }
        break;
      case RegistrationFieldType.DATE:
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          throw new BadRequestException(`${field.key} must be a valid date`);
        }
        break;
      case RegistrationFieldType.SELECT:
        this.validateSelectValue(field, value);
        break;
      case RegistrationFieldType.MULTI_SELECT:
        if (!Array.isArray(value)) {
          throw new BadRequestException(`${field.key} must be an array`);
        }
        for (const selectedValue of value) {
          this.validateSelectValue(field, selectedValue);
        }
        break;
      default:
        break;
    }
  }

  private validateSelectValue(field: RegistrationField, value: unknown) {
    const allowedValues = this.getOptionValues(field.options);

    if (!allowedValues.includes(String(value))) {
      throw new BadRequestException(`${field.key} has an invalid option`);
    }
  }

  private getOptionValues(options: Prisma.JsonValue): string[] {
    if (!Array.isArray(options)) {
      return [];
    }

    return options
      .map((option) => {
        if (
          typeof option === 'object' &&
          option !== null &&
          'value' in option
        ) {
          return String(option.value);
        }

        return typeof option === 'string' ? option : null;
      })
      .filter((value): value is string => value !== null);
  }

  private async generatePublicId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicId = `REG_${randomBytes(8).toString('hex').toUpperCase()}`;
      const existingRegistration = await this.prisma.registration.findUnique({
        where: { publicId },
      });

      if (!existingRegistration) {
        return publicId;
      }
    }

    throw new ConflictException('Could not generate unique registration ID');
  }

  private async findRegistrationOrThrow(id: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  private isEmpty(value: unknown) {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  private toRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private async enqueueRegistrationPipeline(
    registrationId: string,
    eventId: string,
    source: RegistrationSource,
  ) {
    if (
      !this.configService.get<boolean>('REGISTRATION_PIPELINE_ENABLED', true)
    ) {
      return;
    }

    try {
      await this.registrationPipelineQueue.add(
        'registration.created',
        {
          registrationId,
          eventId,
          source,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            count: 100,
          },
          removeOnFail: false,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue registration pipeline for ${registrationId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private readonly registrationInclude = {
    event: {
      select: { id: true, titleAr: true, titleEn: true, status: true },
    },
    attendeeType: {
      select: { id: true, code: true, nameAr: true, nameEn: true },
    },
  } satisfies Prisma.RegistrationInclude;
}
