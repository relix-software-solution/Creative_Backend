import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { safeDeleteUploadFile } from '../../common/utils/upload-file.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateEventBrandingDto } from './dto/create-event-branding.dto';
import { EventBrandingThemeDto } from './dto/event-branding-theme.dto';
import { UpdateEventBrandingDto } from './dto/update-event-branding.dto';

export const DEFAULT_EVENT_BRANDING_THEME = {
  primary: '#A88042',
  primaryHover: '#8F6D37',
  background: '#F8F8FF',
  text: '#4B4B4B',
  radius: '1.5rem',
};

@Injectable()
export class EventBrandingService {
  private readonly logger = new Logger(EventBrandingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventBrandingDto) {
    await this.ensureEventExists(dto.eventId);

    const existingBranding = await this.prisma.eventBranding.findUnique({
      where: { eventId: dto.eventId },
    });

    if (existingBranding) {
      throw new ConflictException('Branding already exists for this event');
    }

    return this.prisma.eventBranding.create({
      data: {
        eventId: dto.eventId,
        logoUrl: dto.logoUrl,
        backgroundImageUrl: dto.backgroundImageUrl,
        certificateImageUrl: dto.certificateImageUrl,
        theme: this.mergeTheme(dto.theme),
      },
    });
  }

  async findAll() {
    return this.prisma.eventBranding.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true },
        },
      },
    });
  }

  async findOne(eventId: string) {
    await this.ensureEventExists(eventId);

    const branding = await this.prisma.eventBranding.findFirst({
      where: { eventId, isActive: true },
    });

    if (!branding) {
      throw new NotFoundException('Active event branding not found');
    }

    return branding;
  }

  async findActiveOrNull(eventId: string) {
    return this.prisma.eventBranding.findFirst({
      where: { eventId, isActive: true },
      select: {
        id: true,
        eventId: true,
        logoUrl: true,
        backgroundImageUrl: true,
        certificateImageUrl: true,
        theme: true,
        isActive: true,
      },
    });
  }

  async update(eventId: string, dto: UpdateEventBrandingDto) {
    await this.ensureEventExists(eventId);

    if (dto.eventId && dto.eventId !== eventId) {
      throw new BadRequestException('Body eventId must match route eventId');
    }

    const existingBranding = await this.prisma.eventBranding.findUnique({
      where: { eventId },
    });

    if (!existingBranding) {
      throw new NotFoundException('Event branding not found');
    }

    const updatedBranding = await this.prisma.eventBranding.update({
      where: { eventId },
      data: {
        logoUrl: dto.logoUrl,
        backgroundImageUrl: dto.backgroundImageUrl,
        certificateImageUrl: dto.certificateImageUrl,
        theme:
          dto.theme === undefined
            ? undefined
            : this.mergeTheme(
                dto.theme,
                this.toThemeRecord(existingBranding.theme),
              ),
        isActive: true,
      },
    });

    await this.deleteReplacedFiles(existingBranding, dto);

    return updatedBranding;
  }

  async remove(eventId: string) {
    await this.ensureEventExists(eventId);

    const existingBranding = await this.prisma.eventBranding.findUnique({
      where: { eventId },
    });

    if (!existingBranding) {
      throw new NotFoundException('Event branding not found');
    }

    await this.prisma.eventBranding.delete({
      where: { eventId },
    });

    await Promise.all([
      safeDeleteUploadFile(
        existingBranding.logoUrl,
        'event-branding',
        this.logger,
      ),
      safeDeleteUploadFile(
        existingBranding.backgroundImageUrl,
        'event-branding',
        this.logger,
      ),
      safeDeleteUploadFile(
        existingBranding.certificateImageUrl,
        'event-branding',
        this.logger,
      ),
    ]);

    return { success: true, deleted: true, eventId };
  }

  async removeCertificateImage(eventId: string) {
    return this.removeImage(eventId, 'certificateImageUrl');
  }

  async removeLogoImage(eventId: string) {
    return this.removeImage(eventId, 'logoUrl');
  }

  async removeBackgroundImage(eventId: string) {
    return this.removeImage(eventId, 'backgroundImageUrl');
  }

  private async removeImage(
    eventId: string,
    field: 'logoUrl' | 'backgroundImageUrl' | 'certificateImageUrl',
  ) {
    await this.ensureEventExists(eventId);

    const existingBranding = await this.prisma.eventBranding.findUnique({
      where: { eventId },
    });

    if (!existingBranding) {
      throw new NotFoundException('Event branding not found');
    }

    const oldImageUrl = existingBranding[field];

    if (!oldImageUrl) {
      return {
        eventId,
        field,
        removed: false,
        alreadyMissing: true,
        entity: existingBranding,
      };
    }

    const updatedBranding = await this.prisma.eventBranding.update({
      where: { eventId },
      data: { [field]: null },
    });
    await safeDeleteUploadFile(
      oldImageUrl,
      'event-branding',
      this.logger,
    );

    return {
      eventId,
      field,
      removed: true,
      alreadyMissing: false,
      entity: updatedBranding,
    };
  }

  private async deleteReplacedFiles(
    existingBranding: {
      logoUrl: string | null;
      backgroundImageUrl: string | null;
      certificateImageUrl: string | null;
    },
    dto: UpdateEventBrandingDto,
  ) {
    await Promise.all([
      dto.logoUrl && existingBranding.logoUrl !== dto.logoUrl
        ? safeDeleteUploadFile(
            existingBranding.logoUrl,
            'event-branding',
            this.logger,
          )
        : undefined,
      dto.backgroundImageUrl &&
      existingBranding.backgroundImageUrl !== dto.backgroundImageUrl
        ? safeDeleteUploadFile(
            existingBranding.backgroundImageUrl,
            'event-branding',
            this.logger,
          )
        : undefined,
      dto.certificateImageUrl &&
      existingBranding.certificateImageUrl !== dto.certificateImageUrl
        ? safeDeleteUploadFile(
            existingBranding.certificateImageUrl,
            'event-branding',
            this.logger,
          )
        : undefined,
    ]);
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

  private mergeTheme(
    theme?: EventBrandingThemeDto,
    base: Record<string, string> = DEFAULT_EVENT_BRANDING_THEME,
  ) {
    return {
      ...DEFAULT_EVENT_BRANDING_THEME,
      ...base,
      ...(theme ?? {}),
    } satisfies Prisma.InputJsonObject;
  }

  private toThemeRecord(value: Prisma.JsonValue): Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return DEFAULT_EVENT_BRANDING_THEME;
    }

    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
}
