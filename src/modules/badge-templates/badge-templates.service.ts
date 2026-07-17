import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBadgeTemplate, Prisma } from '@prisma/client';
import { safeDeleteUploadFile } from '../../common/utils/upload-file.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QrImageService } from '../qr/qr-image.service';
import { QrService } from '../qr/qr.service';
import {
  BadgeTemplateFieldDto,
  UpsertBadgeTemplateDto,
} from './dto/badge-template.dto';
import { ListBadgeTemplatesQueryDto } from './dto/list-badge-templates-query.dto';

const DEFAULT_COLORS = {
  primary: '#A88042',
  text: '#4B4B4B',
  background: '#FFFFFF',
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const FIXED_FIELDS = [
  {
    key: 'fullName',
    labelAr: 'الاسم الكامل',
    labelEn: 'Full Name',
    source: 'FIXED',
    type: 'TEXT',
    required: true,
  },
  {
    key: 'phone',
    labelAr: 'رقم الهاتف',
    labelEn: 'Phone',
    source: 'FIXED',
    type: 'TEXT',
    required: true,
  },
  {
    key: 'email',
    labelAr: 'البريد الإلكتروني',
    labelEn: 'Email',
    source: 'FIXED',
    type: 'EMAIL',
    required: false,
  },
  {
    key: 'publicId',
    labelAr: 'رقم التسجيل',
    labelEn: 'Registration ID',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'companyName',
    labelAr: 'الشركة',
    labelEn: 'Company Name',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'jobTitle',
    labelAr: 'المسمى الوظيفي',
    labelEn: 'Job Title',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'externalId',
    labelAr: 'المعرف الخارجي',
    labelEn: 'External ID',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'attendeeType.code',
    labelAr: 'رمز نوع الحضور',
    labelEn: 'Attendee Type Code',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'attendeeType.nameAr',
    labelAr: 'نوع الحضور',
    labelEn: 'Attendee Type Arabic Name',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
  {
    key: 'attendeeType.nameEn',
    labelAr: 'نوع الحضور بالإنجليزية',
    labelEn: 'Attendee Type English Name',
    source: 'FIXED',
    type: 'TEXT',
    required: false,
  },
];

const SYSTEM_FIELDS = [
  {
    key: 'qrCode',
    labelAr: 'رمز QR',
    labelEn: 'QR Code',
    source: 'SYSTEM',
    type: 'QR',
    required: false,
  },
  {
    key: 'qrToken',
    labelAr: 'رمز QR النصي',
    labelEn: 'QR Token',
    source: 'SYSTEM',
    type: 'TEXT',
    required: false,
  },
];

@Injectable()
export class BadgeTemplatesService {
  private readonly logger = new Logger(BadgeTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
  ) {}

  async create(dto: UpsertBadgeTemplateDto) {
    if (!dto.eventId) {
      throw new BadRequestException('eventId is required');
    }

    await this.ensureEventExists(dto.eventId);

    const existingTemplate = await this.prisma.eventBadgeTemplate.findUnique({
      where: { eventId: dto.eventId },
    });

    if (existingTemplate) {
      throw new ConflictException(
        'Badge template already exists for this event',
      );
    }

    return this.prisma.eventBadgeTemplate.create({
      data: {
        eventId: dto.eventId,
        name: this.requiredString(dto.name, 'name'),
        widthMm: this.requiredPositiveInt(dto.widthMm, 'widthMm'),
        heightMm: this.requiredPositiveInt(dto.heightMm, 'heightMm'),
        backgroundImageUrl: dto.backgroundImageUrl,
        colors: this.toJsonObject(this.mergeColors(dto.colors)),
        layout: this.toJsonObject(this.normalizeLayout(dto.layout ?? {})),
        selectedFields: this.toJsonArray(dto.selectedFields ?? []),
      },
    });
  }

  async findAll(query: ListBadgeTemplatesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.EventBadgeTemplateWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.eventBadgeTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          event: {
            select: { id: true, titleAr: true, titleEn: true },
          },
        },
      }),
      this.prisma.eventBadgeTemplate.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findByEvent(eventId: string) {
    await this.ensureEventExists(eventId);

    const template = await this.prisma.eventBadgeTemplate.findFirst({
      where: { eventId, isActive: true },
    });

    if (!template) {
      throw new NotFoundException('Active badge template not found');
    }

    return template;
  }

  async findActiveSummaryOrNull(eventId: string) {
    const template = await this.prisma.eventBadgeTemplate.findFirst({
      where: { eventId, isActive: true },
      select: {
        id: true,
        widthMm: true,
        heightMm: true,
        colors: true,
        selectedFields: true,
      },
    });

    return template ?? null;
  }

  async findActiveTemplateOrNull(eventId: string) {
    return this.prisma.eventBadgeTemplate.findFirst({
      where: { eventId, isActive: true },
    });
  }

  async update(eventId: string, dto: UpsertBadgeTemplateDto) {
    await this.ensureEventExists(eventId);

    if (dto.eventId && dto.eventId !== eventId) {
      throw new BadRequestException('Body eventId must match route eventId');
    }

    const existingTemplate = await this.prisma.eventBadgeTemplate.findUnique({
      where: { eventId },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Badge template not found');
    }

    const oldBackgroundImageUrl = existingTemplate.backgroundImageUrl;
    const updatedTemplate = await this.prisma.eventBadgeTemplate.update({
      where: { eventId },
      data: {
        name: dto.name,
        widthMm: this.optionalPositiveInt(dto.widthMm, 'widthMm'),
        heightMm: this.optionalPositiveInt(dto.heightMm, 'heightMm'),
        backgroundImageUrl: dto.backgroundImageUrl,
        colors:
          dto.colors === undefined
            ? undefined
            : this.toJsonObject(
                this.mergeColors(
                  dto.colors,
                  this.toRecord(existingTemplate.colors),
                ),
              ),
        layout:
          dto.layout === undefined
            ? undefined
            : this.toJsonObject(this.normalizeLayout(dto.layout)),
        selectedFields:
          dto.selectedFields === undefined
            ? undefined
            : this.toJsonArray(dto.selectedFields),
        isActive: true,
      },
    });

    if (
      dto.backgroundImageUrl &&
      oldBackgroundImageUrl &&
      oldBackgroundImageUrl !== dto.backgroundImageUrl
    ) {
      await safeDeleteUploadFile(
        oldBackgroundImageUrl,
        'badge-templates',
        this.logger,
      );
    }

    return updatedTemplate;
  }

  async remove(eventId: string) {
    await this.ensureEventExists(eventId);

    const existingTemplate = await this.prisma.eventBadgeTemplate.findUnique({
      where: { eventId },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Badge template not found');
    }

    const backgroundImageUrl = existingTemplate.backgroundImageUrl;

    await this.prisma.eventBadgeTemplate.delete({ where: { eventId } });

    await safeDeleteUploadFile(
      backgroundImageUrl,
      'badge-templates',
      this.logger,
    );

    return { deleted: true, eventId };
  }

  async removeBackgroundImage(eventId: string) {
    await this.ensureEventExists(eventId);

    const existingTemplate = await this.prisma.eventBadgeTemplate.findUnique({
      where: { eventId },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Badge template not found');
    }

    if (!existingTemplate.backgroundImageUrl) {
      return {
        eventId,
        field: 'backgroundImageUrl',
        removed: false,
        alreadyMissing: true,
        entity: existingTemplate,
      };
    }

    const oldBackgroundImageUrl = existingTemplate.backgroundImageUrl;

    const updatedTemplate = await this.prisma.eventBadgeTemplate.update({
      where: { eventId },
      data: { backgroundImageUrl: null },
    });
    await safeDeleteUploadFile(
      oldBackgroundImageUrl,
      'badge-templates',
      this.logger,
    );

    return {
      eventId,
      field: 'backgroundImageUrl',
      removed: true,
      alreadyMissing: false,
      entity: updatedTemplate,
    };
  }

  async availableFields(eventId: string) {
    return {
      fields: await this.getAvailableFieldDefinitions(eventId),
    };
  }

  async getAvailableFieldDefinitions(eventId: string) {
    await this.ensureEventExists(eventId);

    const custom = await this.prisma.registrationField.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        key: true,
        labelAr: true,
        labelEn: true,
        type: true,
        isRequired: true,
        options: true,
      },
    });

    return [
      ...FIXED_FIELDS,
      ...SYSTEM_FIELDS,
      ...custom.map((field) => ({
        key: field.key,
        labelAr: field.labelAr,
        labelEn: field.labelEn,
        source: 'CUSTOM',
        type: field.type,
        required: field.isRequired,
        ...(field.options === null ? {} : { options: field.options }),
      })),
    ];
  }

  async resolvedBadgeData(eventId: string, registrationId: string) {
    await this.ensureEventExists(eventId);
    const template = await this.findByEvent(eventId);
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    if (registration.eventId !== eventId) {
      throw new BadRequestException(
        'Registration must belong to the same event',
      );
    }

    const qr = await this.getQrMetadata(registration.id, registration.publicId);
    const fields = this.resolveFields(
      template.selectedFields,
      registration,
      qr,
    );

    return {
      template: {
        id: template.id,
        eventId: template.eventId,
        name: template.name,
        widthMm: template.widthMm,
        heightMm: template.heightMm,
        backgroundImageUrl: template.backgroundImageUrl,
        colors: template.colors,
        layout: template.layout,
        selectedFields: template.selectedFields,
      },
      registration: {
        id: registration.id,
        publicId: registration.publicId,
        fullName: registration.fullName,
        phone: registration.phone,
        email: registration.email,
        attendeeType: registration.attendeeType,
      },
      qr,
      fields,
    };
  }

  async resolveActiveBadgeForRegistration(input: {
    eventId: string;
    registration: {
      id: string;
      publicId: string;
      eventId: string;
      fullName: string;
      phone: string | null;
      email: string | null;
      customFields: Prisma.JsonValue;
      attendeeType: {
        id: string;
        code: string;
        nameAr: string;
        nameEn: string | null;
      };
    };
    qr?: { qrToken: string; imageUrl: string; relativePath: string } | null;
    template?: EventBadgeTemplate | null;
    requestBaseUrl?: string;
  }) {
    const template =
      input.template ??
      (await this.prisma.eventBadgeTemplate.findFirst({
        where: { eventId: input.eventId, isActive: true },
      }));

    if (!template) {
      return null;
    }

    if (input.registration.eventId !== input.eventId) {
      throw new BadRequestException(
        'Registration must belong to the same event',
      );
    }

    const qr =
      input.qr ??
      (await this.getQrMetadata(
        input.registration.id,
        input.registration.publicId,
        input.requestBaseUrl,
      ));

    return {
      templateId: template.id,
      widthMm: template.widthMm,
      heightMm: template.heightMm,
      backgroundImageUrl: template.backgroundImageUrl,
      colors: template.colors,
      layout: template.layout,
      selectedFields: template.selectedFields,
      fields: this.resolveFields(
        template.selectedFields,
        input.registration,
        qr,
      ),
    };
  }

  private async getQrMetadata(
    registrationId: string,
    registrationPublicId: string,
    requestBaseUrl?: string,
  ) {
    const qr = await this.qrService.generate(registrationId);
    const image =
      (await this.qrImageService.getRegistrationQrImageMetadata({
        registrationPublicId,
        requestBaseUrl,
      })) ??
      (await this.qrImageService.generateRegistrationQrImage({
        registrationPublicId,
        qrToken: qr.qrToken,
        requestBaseUrl,
      }));

    return {
      qrToken: qr.qrToken,
      imageUrl: image.publicUrl,
      relativePath: image.relativePath,
    };
  }

  private resolveFields(
    selectedFieldsValue: Prisma.JsonValue,
    registration: {
      fullName: string;
      phone: string | null;
      email: string | null;
      publicId: string;
      companyName?: string | null;
      jobTitle?: string | null;
      externalId?: string | null;
      customFields: Prisma.JsonValue;
      attendeeType: { code: string; nameAr: string; nameEn: string | null };
    },
    qr: { qrToken: string; imageUrl: string; relativePath: string },
  ) {
    return this.toFieldArray(selectedFieldsValue).map((field) => ({
      key: field.key,
      source: field.source,
      label: field.label ?? field.key,
      value: this.resolveFieldValue(field, registration, qr),
    }));
  }

  private resolveFieldValue(
    field: BadgeTemplateFieldDto,
    registration: {
      fullName: string;
      phone: string | null;
      email: string | null;
      publicId: string;
      companyName?: string | null;
      jobTitle?: string | null;
      externalId?: string | null;
      customFields: Prisma.JsonValue;
      attendeeType: { code: string; nameAr: string; nameEn: string | null };
    },
    qr: { qrToken: string; imageUrl: string; relativePath: string },
  ) {
    if (field.source === 'SYSTEM') {
      if (field.key === 'qrCode') {
        return qr.imageUrl;
      }

      if (field.key === 'qrToken') {
        return qr.qrToken;
      }
    }

    if (field.source === 'CUSTOM') {
      return this.toRecord(registration.customFields)[field.key] ?? null;
    }

    const fixedValues: Record<string, unknown> = {
      fullName: registration.fullName,
      phone: registration.phone,
      email: registration.email,
      publicId: registration.publicId,
      companyName: registration.companyName,
      jobTitle: registration.jobTitle,
      externalId: registration.externalId,
      'attendeeType.code': registration.attendeeType.code,
      'attendeeType.nameAr': registration.attendeeType.nameAr,
      'attendeeType.nameEn': registration.attendeeType.nameEn,
    };

    return fixedValues[field.key] ?? null;
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

  private mergeColors(
    colors?: Record<string, string>,
    base: Record<string, unknown> = DEFAULT_COLORS,
  ) {
    if (colors) {
      for (const [key, value] of Object.entries(colors)) {
        if (
          (key === 'primary' || key === 'text' || key === 'background') &&
          !this.isHexColor(value)
        ) {
          throw new BadRequestException(`${key} must be a valid hex color`);
        }
      }
    }

    return {
      ...DEFAULT_COLORS,
      ...Object.fromEntries(
        Object.entries(base).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      ...(colors ?? {}),
    };
  }

  private normalizeLayout(layout: Record<string, unknown>) {
    if (
      typeof layout !== 'object' ||
      layout === null ||
      Array.isArray(layout)
    ) {
      throw new BadRequestException('layout must be a JSON object');
    }

    const normalizedLayout: Record<string, unknown> = { ...layout };
    const fields = normalizedLayout.fields;

    if (fields === undefined) {
      return normalizedLayout;
    }

    if (
      typeof fields !== 'object' ||
      fields === null ||
      Array.isArray(fields)
    ) {
      throw new BadRequestException('layout.fields must be a JSON object');
    }

    normalizedLayout.fields = Object.fromEntries(
      Object.entries(fields).map(([fieldKey, fieldLayout]) => {
        if (
          typeof fieldLayout !== 'object' ||
          fieldLayout === null ||
          Array.isArray(fieldLayout)
        ) {
          throw new BadRequestException(
            `layout.fields.${fieldKey} must be a JSON object`,
          );
        }

        const normalizedFieldLayout = {
          ...(fieldLayout as Record<string, unknown>),
        };

        if (
          normalizedFieldLayout.bold !== undefined &&
          typeof normalizedFieldLayout.bold !== 'boolean'
        ) {
          throw new BadRequestException(
            `layout.fields.${fieldKey}.bold must be a boolean`,
          );
        }

        if (
          normalizedFieldLayout.bold === undefined &&
          normalizedFieldLayout.fontWeight !== undefined
        ) {
          if (normalizedFieldLayout.fontWeight === 'bold') {
            normalizedFieldLayout.bold = true;
          } else if (normalizedFieldLayout.fontWeight === 'normal') {
            normalizedFieldLayout.bold = false;
          }
        }

        this.validateOptionalLayoutColor(
          normalizedFieldLayout.textColor,
          `layout.fields.${fieldKey}.textColor`,
        );
        this.validateOptionalLayoutColor(
          normalizedFieldLayout.boldColor,
          `layout.fields.${fieldKey}.boldColor`,
        );

        return [fieldKey, normalizedFieldLayout];
      }),
    );

    return normalizedLayout;
  }

  private validateOptionalLayoutColor(value: unknown, field: string) {
    if (value === undefined) {
      return;
    }

    if (typeof value !== 'string' || !this.isHexColor(value)) {
      throw new BadRequestException(`${field} must be a valid hex color`);
    }
  }

  private isHexColor(value: string) {
    return HEX_COLOR_PATTERN.test(value);
  }

  private toFieldArray(value: Prisma.JsonValue): BadgeTemplateFieldDto[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is BadgeTemplateFieldDto => {
      return (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        typeof item.key === 'string' &&
        typeof item.source === 'string' &&
        item.visible !== false
      );
    });
  }

  private toRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private toJsonObject(value: Record<string, unknown>) {
    return value as Prisma.InputJsonObject;
  }

  private toJsonArray(value: unknown[]) {
    return value as Prisma.InputJsonArray;
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
}
