import {
  BadRequestException,
  Injectable,
  GoneException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, RegistrationSource } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { BadgeTemplatesService } from '../badge-templates/badge-templates.service';
import { DigitalTicketTemplatesService } from '../digital-ticket-templates/digital-ticket-templates.service';
import { DigitalTicketStatusService } from '../digital-tickets/digital-ticket-status.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { WhatsappTicketRequestsService } from '../whatsapp-ticket-requests/whatsapp-ticket-requests.service';
import { ListPublicEventsQueryDto } from './dto/list-public-events-query.dto';
import { PublicRegisterDto } from './dto/public-register.dto';
import { DigitalTicketsService } from '../digital-tickets/digital-tickets.service';
import { QrService } from '../qr/qr.service';

const publicEventSelect = {
  id: true,
  type: true,
  status: true,
  titleAr: true,
  titleEn: true,
  descriptionAr: true,
  descriptionEn: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  allowReEntry: true,
} satisfies Prisma.EventSelect;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeTemplatesService: BadgeTemplatesService,
    private readonly digitalTicketTemplatesService: DigitalTicketTemplatesService,
    private readonly digitalTicketStatusService: DigitalTicketStatusService,
    private readonly digitalTicketsService: DigitalTicketsService,
    private readonly registrationsService: RegistrationsService,
    private readonly whatsappTicketRequestsService: WhatsappTicketRequestsService,
    private readonly qrService: QrService,
  ) {}

  async findEvents(query: ListPublicEventsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.EventWhereInput = {
      isActive: true,
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

    const [events, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startsAt: 'asc' },
        select: {
          ...publicEventSelect,
          branding: {
            select: {
              logoUrl: true,
              backgroundImageUrl: true,
              certificateImageUrl: true,
              theme: true,
              isActive: true,
            },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    const items = events.map(({ branding, ...event }) => ({
      ...event,
      branding:
        branding?.isActive === true
          ? {
              logoUrl: branding.logoUrl,
              backgroundImageUrl: branding.backgroundImageUrl,
              certificateImageUrl: branding.certificateImageUrl,
              theme: branding.theme,
            }
          : null,
    }));

    return createPaginatedResponse(items, total, page, limit);
  }

  async findEvent(id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, isActive: true },
      select: {
        ...publicEventSelect,
        branding: {
          select: {
            id: true,
            eventId: true,
            logoUrl: true,
            backgroundImageUrl: true,
            certificateImageUrl: true,
            theme: true,
            isActive: true,
          },
        },
        attendeeTypes: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            descriptionAr: true,
            descriptionEn: true,
            isDefault: true,
            sortOrder: true,
          },
        },
        registrationFields: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            attendeeTypeId: true,
            key: true,
            labelAr: true,
            labelEn: true,
            type: true,
            placeholderAr: true,
            placeholderEn: true,
            helpTextAr: true,
            helpTextEn: true,
            isRequired: true,
            options: true,
            validation: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const { attendeeTypes, registrationFields, branding, ...eventDetails } =
      event;
    const badgeTemplate =
      await this.badgeTemplatesService.findActiveSummaryOrNull(id);
    const digitalTicketTemplates =
      await this.digitalTicketTemplatesService.findActiveSummariesOrNull(id);

    return {
      event: eventDetails,
      branding:
        branding?.isActive === true
          ? {
              id: branding.id,
              eventId: branding.eventId,
              logoUrl: branding.logoUrl,
              backgroundImageUrl: branding.backgroundImageUrl,
              certificateImageUrl: branding.certificateImageUrl,
              theme: branding.theme,
            }
          : null,
      badgeTemplate,
      digitalTicketTemplates,
      attendeeTypes,
      registrationFields,
    };
  }
  async register(eventId: string, dto: PublicRegisterDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (!event.isActive) {
      throw new BadRequestException(
        'Event is not open for public registration',
      );
    }

    const templateExists = await this.prisma.digitalTicketTemplate.findFirst({
      where: {
        eventId,
        isActive: true,
        OR: [{ attendeeTypeId: dto.attendeeTypeId }, { attendeeTypeId: null }],
      },
      select: { id: true },
    });

    if (!templateExists) {
      throw new BadRequestException(
        'Digital ticket template is not configured for this event',
      );
    }

    const registration = await this.registrationsService.create({
      ...dto,
      eventId,
      source: RegistrationSource.PUBLIC,
    });

    /*
     * نولد QR ضمن نفس الطلب.
     *
     * بهذا لا يعتمد Staff Scanner على الـBackground Pipeline،
     * ويحصل فورًا على registrationId وQR رسمي.
     */
    const qr = await this.qrService.generate(registration.id);

    let generatedTicket: Awaited<
      ReturnType<DigitalTicketsService['generateForRegistration']>
    >;

    try {
      generatedTicket =
        await this.digitalTicketsService.generateForRegistration(
          registration.id,
          {
            forceRegenerate: true,
          },
        );
    } catch (error) {
      this.logger.error(
        `Digital ticket generation failed for registration ${registration.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new ServiceUnavailableException(
        'Registration was created, but the Digital Ticket image could not be generated',
      );
    }

    const whatsappRequest = await this.createWhatsappRequest(registration.id);

    return {
      registration: {
        id: registration.id,
        publicId: registration.publicId,

        eventId: registration.eventId,
        attendeeTypeId: registration.attendeeTypeId,

        fullName: registration.fullName,
        phone: registration.phone,
        email: registration.email,

        companyName: registration.companyName,
        jobTitle: registration.jobTitle,
        externalId: registration.externalId,

        customFields: registration.customFields ?? {},
        notes: registration.notes,

        status: registration.status,
        source: registration.source,

        registeredAt: registration.registeredAt,
        createdAt: registration.createdAt,
        updatedAt: registration.updatedAt,
      },

      qr: {
        qrToken: qr.compactQrToken ?? qr.qrToken,
        compactQrToken: qr.compactQrToken,
        signedToken: qr.signedQrToken,

        status: qr.status,
        validFrom: qr.validFrom,
        validUntil: qr.validUntil,
        generatedAt: qr.generatedAt,
      },

      /*
       * نكرر أهم القيم في المستوى الأعلى لتسهيل التوافق
       * مع العملاء القديمة.
       */
      id: registration.id,
      publicId: registration.publicId,

      fullName: registration.fullName,
      phone: registration.phone,
      email: registration.email,

      companyName: registration.companyName,
      jobTitle: registration.jobTitle,
      externalId: registration.externalId,

      customFields: registration.customFields ?? {},
      notes: registration.notes,

      attendeeTypeId: registration.attendeeTypeId,
      status: registration.status,

      qrToken: qr.compactQrToken ?? qr.qrToken,

      digitalTicket: {
        status: 'READY',
        imageUrl: generatedTicket.imageUrl,
        relativePath: generatedTicket.relativePath,

        generatedAt:
          generatedTicket.generatedAt?.toISOString?.() ??
          generatedTicket.generatedAt ??
          null,

        templateVersion: generatedTicket.templateVersion,
        pollUrl: null,
      },

      whatsappRequest: this.publicWhatsappRequest(whatsappRequest),
    };
  }
  async findDigitalTicket(publicId: string, token?: string) {
    if (!token) {
      throw new UnauthorizedException(
        'Digital ticket access token is required',
      );
    }

    const registration = await (this.prisma.registration as any).findUnique({
      where: { publicId },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    if (registration.ticketRequestToken !== token) {
      throw new UnauthorizedException('Invalid digital ticket access token');
    }

    if (
      !registration.ticketRequestExpiresAt ||
      registration.ticketRequestExpiresAt.getTime() <= Date.now()
    ) {
      throw new GoneException('Digital ticket access token is expired');
    }

    const { pollUrl: _pollUrl, ...status } =
      await this.digitalTicketStatusService.resolveForRegistration({
        registration,
        includePollUrl: false,
        accessToken: token,
      });

    return status;
  }

  private async createWhatsappRequest(registrationId: string) {
    try {
      return await this.whatsappTicketRequestsService.createForRegistration(
        registrationId,
      );
    } catch (error) {
      this.logger.warn(
        `WhatsApp ticket request link unavailable for ${registrationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      return {
        enabled: false,
        ticketRequestToken: null,
        url: null,
        expiresAt: null,
      };
    }
  }

  private publicWhatsappRequest(input: {
    enabled: boolean;
    ticketRequestToken?: string | null;
    url: string | null;
    expiresAt: string | null;
  }) {
    return {
      enabled: input.enabled,
      url: input.url,
      expiresAt: input.expiresAt,
    };
  }
}
