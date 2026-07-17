import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, EventBadgeTemplate, Prisma } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { BadgeTemplatesService } from '../badge-templates/badge-templates.service';
import { QrImageService } from '../qr/qr-image.service';
import { QrService } from '../qr/qr.service';
import { RegistrationsService } from '../registrations/registrations.service';
import {
  ListAdminVisitorsQueryDto,
  ListVisitorsQueryDto,
} from './dto/list-visitors-query.dto';
import { UpdateStaffVisitorDto } from './dto/update-staff-visitor.dto';

@Injectable()
export class VisitorsService {
  private readonly logger = new Logger(VisitorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeTemplatesService: BadgeTemplatesService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
    private readonly registrationsService: RegistrationsService,
  ) {}

  async findForStaff(
    userId: string,
    query: ListVisitorsQueryDto,
    requestBaseUrl?: string,
  ) {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    const badgeTemplate =
      await this.badgeTemplatesService.findActiveTemplateOrNull(
        assignment.eventId,
      );
    const visitors = await this.findVisitors(query, assignment.eventId, {
      includeQrMetadata: true,
      badgeTemplate,
      requestBaseUrl,
    });

    return {
      event: assignment.event,
      visitors,
    };
  }

  async findForAdmin(query: ListAdminVisitorsQueryDto) {
    return this.findVisitors(query, query.eventId, true);
  }

  async updateForStaff(
    userId: string,
    registrationId: string,
    dto: UpdateStaffVisitorDto,
  ) {
    const assignment = await this.findActiveStaffAssignment(userId);
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        eventId: true,
        fullName: true,
        phone: true,
        email: true,
        companyName: true,
        jobTitle: true,
        customFields: true,
        notes: true,
      },
    });

    if (!registration || registration.eventId !== assignment.eventId) {
      throw new NotFoundException('Registration not found');
    }

    const updatedRegistration = await this.registrationsService.update(
      registrationId,
      dto,
    );

    await this.auditStaffVisitorUpdate(userId, registration, dto);

    return {
      id: updatedRegistration.id,
      publicId: updatedRegistration.publicId,
      status: updatedRegistration.status,
      fullName: updatedRegistration.fullName,
      phone: updatedRegistration.phone,
      email: updatedRegistration.email,
      companyName: updatedRegistration.companyName,
      jobTitle: updatedRegistration.jobTitle,
      customFields: updatedRegistration.customFields,
      attendeeType: updatedRegistration.attendeeType,
      updatedAt: updatedRegistration.updatedAt,
    };
  }

  private async findVisitors(
    query: ListVisitorsQueryDto,
    eventId?: string,
    options:
      | boolean
      | {
          includeEvent?: boolean;
          includeQrMetadata?: boolean;
          badgeTemplate?: EventBadgeTemplate | null;
          requestBaseUrl?: string;
        } = false,
  ) {
    const includeEvent =
      typeof options === 'boolean' ? options : options.includeEvent === true;
    const includeQrMetadata =
      typeof options === 'boolean' ? false : options.includeQrMetadata === true;
    const requestBaseUrl =
      typeof options === 'boolean' ? undefined : options.requestBaseUrl;
    const badgeTemplate =
      typeof options === 'boolean' ? undefined : options.badgeTemplate;
    const { page, limit, skip } = normalizePagination(query);
    const where = this.buildWhere(query, eventId);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.registration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { registeredAt: 'desc' },
        select: {
          id: true,
          publicId: true,
          ...(includeQrMetadata ? { eventId: true, attendeeTypeId: true } : {}),
          ...(includeEvent ? { eventId: true } : {}),
          status: true,
          ...(includeQrMetadata ? { source: true } : {}),
          fullName: true,
          phone: true,
          email: true,
          ...(includeQrMetadata
            ? {
                companyName: true,
                jobTitle: true,
                externalId: true,
                notes: true,
              }
            : {}),
          customFields: true,
          registeredAt: true,
          ...(includeQrMetadata ? { createdAt: true, updatedAt: true } : {}),
          ...(includeEvent
            ? {
                event: {
                  select: { id: true, titleAr: true, titleEn: true },
                },
              }
            : {}),
          attendeeType: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
        },
      }),
      this.prisma.registration.count({ where }),
    ]);

    if (includeQrMetadata) {
      const enrichedItems = await Promise.all(
        items.map((item) =>
          this.withQrMetadata(item, requestBaseUrl, badgeTemplate),
        ),
      );

      return createPaginatedResponse(enrichedItems, total, page, limit);
    }

    return createPaginatedResponse(items, total, page, limit);
  }

  private async findActiveStaffAssignment(userId: string) {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        event: {
          select: { id: true, titleAr: true, titleEn: true },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('No active staff assignment found');
    }

    return assignment;
  }

  private async auditStaffVisitorUpdate(
    userId: string,
    registration: {
      id: string;
      eventId: string;
      fullName: string;
      phone: string | null;
      email: string | null;
      companyName: string | null;
      jobTitle: string | null;
      customFields: Prisma.JsonValue;
      notes: string | null;
    },
    dto: UpdateStaffVisitorDto,
  ) {
    const changedFields = Object.keys(dto).filter((key) => {
      if (key === 'customFields') {
        return dto.customFields !== undefined;
      }

      return dto[key as keyof UpdateStaffVisitorDto] !== undefined;
    });

    if (changedFields.length === 0) {
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          eventId: registration.eventId,
          actorUserId: userId,
          action: AuditAction.UPDATE,
          entityType: 'REGISTRATION',
          entityId: registration.id,
          metadata: {
            source: 'STAFF_VISITOR_EDIT',
            changedFields,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not write audit log for staff visitor update ${registration.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async withQrMetadata<
    T extends {
      id: string;
      publicId: string;
      eventId: string;
      attendeeType: {
        id: string;
        code: string;
        nameAr: string;
        nameEn: string | null;
      };
      fullName: string;
      phone: string | null;
      email: string | null;
      customFields: Prisma.JsonValue;
      attendeeTypeId: string;
    },
  >(
    visitor: T,
    requestBaseUrl?: string,
    badgeTemplate?: EventBadgeTemplate | null,
  ) {
    const { eventId, attendeeTypeId, ...publicVisitor } = visitor;
    const qr = await this.resolveQrMetadata(visitor, requestBaseUrl);
    const badge = await this.resolveBadge(
      visitor,
      qr,
      requestBaseUrl,
      badgeTemplate,
    );

    return {
      ...publicVisitor,
      qr,
      badge,
    };
  }

  private async resolveQrMetadata(
    visitor: { id: string; publicId: string },
    requestBaseUrl?: string,
  ) {
    try {
      const qr = await this.qrService.generate(visitor.id);
      const existingImage =
        await this.qrImageService.getRegistrationQrImageMetadata({
          registrationPublicId: visitor.publicId,
          requestBaseUrl,
        });
      const image =
        existingImage ??
        (await this.qrImageService.generateRegistrationQrImage({
          registrationPublicId: visitor.publicId,
          qrToken: qr.qrToken,
          requestBaseUrl,
        }));

      return {
        qrToken: qr.qrToken,
        imageUrl: image.publicUrl,
        relativePath: image.relativePath,
        status: qr.status,
        validFrom: qr.validFrom,
        validUntil: qr.validUntil,
      };
    } catch (error) {
      this.logger.warn(
        `Could not attach QR metadata for registration ${visitor.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return null;
    }
  }

  private async resolveBadge(
    visitor: {
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
    },
    qr: { qrToken: string; imageUrl: string; relativePath: string } | null,
    requestBaseUrl?: string,
    badgeTemplate?: EventBadgeTemplate | null,
  ) {
    try {
      return await this.badgeTemplatesService.resolveActiveBadgeForRegistration(
        {
          eventId: visitor.eventId,
          registration: visitor,
          qr,
          template: badgeTemplate,
          requestBaseUrl,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not attach badge data for registration ${visitor.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return null;
    }
  }

  private buildWhere(
    query: ListVisitorsQueryDto,
    eventId?: string,
  ): Prisma.RegistrationWhereInput {
    return {
      ...(eventId ? { eventId } : {}),
      ...(query.attendeeTypeId ? { attendeeTypeId: query.attendeeTypeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.fullName ? { fullName: { contains: query.fullName } } : {}),
      ...(query.phone ? { phone: { contains: query.phone } } : {}),
      ...(query.email ? { email: { contains: query.email } } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search } },
              { phone: { contains: query.search } },
              { email: { contains: query.search } },
              { publicId: { contains: query.search } },
            ],
          }
        : {}),
    };
  }
}
