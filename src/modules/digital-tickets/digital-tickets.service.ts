import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BadgeTemplatesService } from '../badge-templates/badge-templates.service';
import { QrImageService } from '../qr/qr-image.service';
import { QrService } from '../qr/qr.service';
import { UpsertDigitalTicketTemplateDto } from '../digital-ticket-templates/dto/digital-ticket-template.dto';
import { GenerateDigitalTicketDto } from './dto/generate-digital-ticket.dto';
import { DigitalTicketImageService } from './image/digital-ticket-image.service';
import { TicketRendererService } from './renderer/ticket-renderer.service';

type TicketFieldDefinition = {
  key: string;
  source: string;
  type: string;
};

const TICKET_SYSTEM_FIELDS: TicketFieldDefinition[] = [
  {
    key: 'eventName',
    source: 'SYSTEM',
    type: 'TEXT',
  },
  {
    key: 'eventDate',
    source: 'SYSTEM',
    type: 'DATE',
  },
  {
    key: 'eventDateRangeFormatted',
    source: 'SYSTEM',
    type: 'TEXT',
  },
  {
    key: 'eventTimeRangeFormatted',
    source: 'SYSTEM',
    type: 'TEXT',
  },
  {
    key: 'venueName',
    source: 'SYSTEM',
    type: 'TEXT',
  },
];

@Injectable()
export class DigitalTicketsService {
  constructor(
    private readonly badgeTemplatesService: BadgeTemplatesService,
    private readonly imageService: DigitalTicketImageService,
    private readonly prisma: PrismaService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
    private readonly renderer: TicketRendererService,
  ) {}

  async generateForRegistration(
    registrationId: string,
    dto: GenerateDigitalTicketDto = {},
  ) {
    const registration = await this.findRegistration(registrationId);

    if (registration.status !== RegistrationStatus.ACTIVE) {
      throw new BadRequestException('Registration must be ACTIVE');
    }

    const template = await this.findActiveTemplateForRegistration(registration);
    const existingImage = await this.findExistingImage(
      registration.id,
      template.id,
      template.version,
    );

    if (
      existingImage &&
      dto.forceRegenerate !== true &&
      (await this.imageService.isGeneratedImageUsable(
        existingImage.relativePath,
      ))
    ) {
      return {
        ...existingImage,
        templateVersion: template.version,
        reused: true,
      };
    }

    const renderInput = await this.buildRenderInput({
      registration,
      template,
      requestBaseUrl: dto.requestBaseUrl,
    });
    const png = await this.renderer.render(renderInput);
    const image = await this.imageService.saveGeneratedImage({
      eventId: registration.eventId,
      registrationId: registration.id,
      templateId: template.id,
      templateVersion: template.version,
      png,
      requestBaseUrl: dto.requestBaseUrl,
    });

    if (
      existingImage?.relativePath &&
      existingImage.relativePath !== image.relativePath
    ) {
      await this.imageService.deleteGeneratedImage(existingImage.relativePath);
    }

    return {
      ...image,
      templateVersion: template.version,
    };
  }

  async resolveActiveTemplateForRegistration(registrationId: string) {
    const registration = await this.findRegistration(registrationId);
    return this.findActiveTemplateForRegistration(registration);
  }

  async findLatestForRegistration(registrationId: string) {
    await this.ensureRegistrationExists(registrationId);

    const image = await this.prisma.digitalTicketImage.findFirst({
      where: { registrationId },
      orderBy: { generatedAt: 'desc' },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            attendeeTypeId: true,
            version: true,
          },
        },
      },
    });

    if (!image) {
      throw new NotFoundException('Digital ticket image not found');
    }

    return image;
  }

  async resolveUsableForRegistration(registrationId: string) {
    const registration = await this.findRegistration(registrationId);
    const template = await this.findActiveTemplateForRegistration(registration);
    const existingImage = await this.findExistingImage(
      registration.id,
      template.id,
      template.version,
    );

    if (
      existingImage &&
      (await this.imageService.isGeneratedImageUsable(
        existingImage.relativePath,
      ))
    ) {
      return existingImage;
    }

    return this.generateForRegistration(registrationId);
  }

  async previewForEvent(
    eventId: string,
    dto: UpsertDigitalTicketTemplateDto & {
      registrationId?: string;
      requestBaseUrl?: string;
    },
  ) {
    const registration = dto.registrationId
      ? await this.findRegistration(dto.registrationId)
      : await this.findPreviewRegistration(eventId);

    if (registration.eventId !== eventId) {
      throw new BadRequestException(
        'Preview registration must belong to the same event',
      );
    }

    const baseTemplate = dto.registrationId
      ? await this.findActiveTemplateForRegistration(registration)
      : await this.findAnyActiveTemplate(eventId);
    const template = {
      ...baseTemplate,
      ...Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
      eventId,
      attendeeTypeId: dto.attendeeTypeId ?? baseTemplate.attendeeTypeId,
      widthPx: dto.widthPx ?? baseTemplate.widthPx,
      heightPx: dto.heightPx ?? baseTemplate.heightPx,
      theme: dto.theme ?? baseTemplate.theme,
      elements: dto.elements ?? baseTemplate.elements,
      selectedFields: dto.selectedFields ?? baseTemplate.selectedFields,
      version: baseTemplate.version,
    };

    await this.validateSelectedFields(eventId, template.selectedFields);

    const renderInput = await this.buildRenderInput({
      registration,
      template,
      requestBaseUrl: dto.requestBaseUrl,
    });
    const png = await this.renderer.render(renderInput);

    return this.imageService.savePreviewImage({
      png,
      requestBaseUrl: dto.requestBaseUrl,
    });
  }

  private async buildRenderInput(input: {
    registration: Awaited<
      ReturnType<DigitalTicketsService['findRegistration']>
    >;
    template: {
      widthPx: number;
      heightPx: number;
      backgroundImageUrl?: string | null;
      theme: Prisma.JsonValue | Record<string, unknown>;
      elements: Prisma.JsonValue | unknown[];
      selectedFields: Prisma.JsonValue | unknown[];
    };
    requestBaseUrl?: string;
  }) {
    await this.validateSelectedFields(
      input.registration.eventId,
      input.template.selectedFields,
    );

    const qr = await this.qrService.generate(input.registration.id);
    const qrScanToken = qr.compactQrToken ?? qr.qrToken;
    const qrImage = await this.qrImageService.generateRegistrationQrImage({
      registrationPublicId: input.registration.publicId,
      qrToken: qrScanToken,
      requestBaseUrl: input.requestBaseUrl,
    });
    const fields = await this.resolveFields(input.registration);

    return {
      template: input.template,
      branding:
        input.registration.event.branding?.isActive === true
          ? input.registration.event.branding
          : null,
      registration: input.registration,
      qrImage,
      fields: {
        ...fields,
        qrCode: qrImage.publicUrl,
      },
    };
  }

  private async resolveFields(
    registration: Awaited<
      ReturnType<DigitalTicketsService['findRegistration']>
    >,
  ) {
    const customFields = this.toRecord(registration.customFields);

    const startsAt = registration.event.startsAt;
    const endsAt = registration.event.endsAt;
    const timeZone = registration.event.timezone;

    return {
      ...customFields,

      fullName: registration.fullName,

      /**
       * نبقي اسم الفعالية ضمن البيانات للتوافق مع
       * القوالب القديمة، لكنه لن يظهر داخل التصميم الجديد.
       */
      eventName:
        registration.event.titleAr?.trim() ||
        registration.event.titleEn?.trim() ||
        'Event',

      /**
       * حقول قديمة للتوافق مع أي قالب سابق.
       */
      eventDateFormatted: this.formatSingleEventDate(startsAt, timeZone),

      eventTimeFormatted: this.formatSingleEventTime(startsAt, timeZone),

      /**
       * الحقول الجديدة التي يستخدمها تصميم البطاقة.
       *
       * مثال:
       * 2/8/2026 - 5/8/2026
       */
      eventDateRangeFormatted: this.formatEventDateRange(
        startsAt,
        endsAt,
        timeZone,
      ),

      /**
       * مثال:
       * 3:00 PM - 10:00 PM
       */
      eventTimeRangeFormatted: this.formatEventTimeRange(
        startsAt,
        endsAt,
        timeZone,
      ),

      phone: registration.phone,
      email: registration.email,
      companyName: registration.companyName,
      jobTitle: registration.jobTitle,
      externalId: registration.externalId,
    };
  }

  private formatEventDateRange(
    startsAt: Date | null | undefined,
    endsAt: Date | null | undefined,
    timeZone?: string,
  ) {
    const startDate = this.formatSingleEventDate(startsAt, timeZone);

    const endDate = this.formatSingleEventDate(endsAt, timeZone);

    if (!startDate) {
      return endDate;
    }

    if (!endDate || startDate === endDate) {
      return startDate;
    }

    return `${startDate} - ${endDate}`;
  }

  private formatEventTimeRange(
    startsAt: Date | null | undefined,
    endsAt: Date | null | undefined,
    timeZone?: string,
  ) {
    const startTime = this.formatSingleEventTime(startsAt, timeZone);

    const endTime = this.formatSingleEventTime(endsAt, timeZone);

    if (!startTime) {
      return endTime;
    }

    if (!endTime || startTime === endTime) {
      return startTime;
    }

    return `${startTime} - ${endTime}`;
  }

  private formatSingleEventDate(
    value: Date | null | undefined,
    timeZone?: string,
  ) {
    if (!value || Number.isNaN(value.getTime())) {
      return '';
    }

    const parts = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(value);

    const day = parts.find((part) => part.type === 'day')?.value;

    const month = parts.find((part) => part.type === 'month')?.value;

    const year = parts.find((part) => part.type === 'year')?.value;

    if (!day || !month || !year) {
      return '';
    }

    /**
     * Number يزيل الصفر من البداية:
     *
     * 02 → 2
     * 08 → 8
     */
    return `${Number(day)}/${Number(month)}/${year}`;
  }

  private formatSingleEventTime(
    value: Date | null | undefined,
    timeZone?: string,
  ) {
    if (!value || Number.isNaN(value.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    })
      .format(value)
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private async validateSelectedFields(eventId: string, value: unknown) {
    const selectedFields = this.toFieldArray(value);
    const availableFields = await this.availableFields(eventId);
    const allowedKeys = new Set(availableFields.map((field) => field.key));
    const unknown = selectedFields.find((field) => !allowedKeys.has(field.key));

    if (unknown) {
      throw new BadRequestException('selectedFields contains unknown keys');
    }
  }

  private async availableFields(eventId: string) {
    const badgeFields =
      await this.badgeTemplatesService.getAvailableFieldDefinitions(eventId);
    const existing = new Set(badgeFields.map((field) => field.key));

    return [
      ...badgeFields,
      ...TICKET_SYSTEM_FIELDS.filter((field) => !existing.has(field.key)),
    ];
  }

  private async findRegistration(registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        attendeeType: true,
        event: {
          include: {
            branding: true,
            venues: { orderBy: { createdAt: 'asc' }, take: 1 },
          },
        },
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  private async ensureRegistrationExists(registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: { id: true },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }
  }

  private async findPreviewRegistration(eventId: string) {
    const registration = await this.prisma.registration.findFirst({
      where: { eventId, status: RegistrationStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      include: {
        attendeeType: true,
        event: {
          include: {
            branding: true,
            venues: { orderBy: { createdAt: 'asc' }, take: 1 },
          },
        },
      },
    });

    if (!registration) {
      throw new NotFoundException('No active registration found for preview');
    }

    return registration;
  }

  private async findActiveTemplateForRegistration(
    registration: Awaited<
      ReturnType<DigitalTicketsService['findRegistration']>
    >,
  ) {
    const templates = await this.prisma.digitalTicketTemplate.findMany({
      where: {
        eventId: registration.eventId,
        isActive: true,
        OR: [
          { attendeeTypeId: registration.attendeeTypeId },
          { attendeeTypeId: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const template =
      templates.find(
        (item) => item.attendeeTypeId === registration.attendeeTypeId,
      ) ?? templates.find((item) => item.attendeeTypeId === null);

    if (!template) {
      throw new NotFoundException('Active digital ticket template not found');
    }

    return template;
  }

  private findExistingImage(
    registrationId: string,
    templateId: string,
    templateVersion: number,
  ) {
    return this.prisma.digitalTicketImage.findUnique({
      where: {
        registrationId_templateId_templateVersion: {
          registrationId,
          templateId,
          templateVersion,
        },
      },
    });
  }

  private async findAnyActiveTemplate(eventId: string) {
    const template = await this.prisma.digitalTicketTemplate.findFirst({
      where: { eventId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!template) {
      throw new NotFoundException('Active digital ticket template not found');
    }

    return template;
  }

  private toFieldArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is { key: string; source?: string } => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return false;
      }

      const field = item as Record<string, unknown>;

      return typeof field.key === 'string' && field.visible !== false;
    });
  }

  private toRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private resolveTicketLocale(
    event: {
      titleAr?: string | null;
      titleEn?: string | null;
      descriptionAr?: string | null;
      descriptionEn?: string | null;
    },
    customFields: Record<string, unknown>,
  ): 'ar' | 'en' {
    const requestedLocale = String(
      customFields.ticketLocale ?? customFields.locale ?? '',
    ).toLowerCase();

    if (requestedLocale === 'en' || requestedLocale === 'en-us') {
      return 'en';
    }

    if (requestedLocale === 'ar' || requestedLocale === 'ar-sy') {
      return 'ar';
    }

    return event.descriptionAr || event.titleAr ? 'ar' : 'en';
  }
}
