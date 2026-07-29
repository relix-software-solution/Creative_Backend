import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
import { StaffOfflineSnapshotQueryDto } from './dto/staff-offline-snapshot-query.dto';
import { UpdateStaffVisitorDto } from './dto/update-staff-visitor.dto';

type StaffOfflineSnapshotCursor = {
  version: 2;
  eventId: string;
  snapshotAsOf: string;
  createdAt: string;
  id: string;
};

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

  async getOfflineStateForStaff(userId: string, requestBaseUrl?: string) {
    const assignment = await this.findActiveStaffAssignment(userId);

    const [badgeTemplate, visitorsAggregate] = await Promise.all([
      this.badgeTemplatesService.findActiveTemplateOrNull(assignment.eventId),

      this.prisma.registration.aggregate({
        where: {
          eventId: assignment.eventId,
        },

        _count: {
          _all: true,
        },

        _max: {
          updatedAt: true,
        },
      }),
    ]);

    const visitorsCount = visitorsAggregate._count._all;

    const visitorsUpdatedAt =
      visitorsAggregate._max.updatedAt?.toISOString() ?? null;

    /*
     * يتغير عند:
     * - إنشاء زائر.
     * - تعديل زائر.
     * - حذف زائر.
     *
     * count يكشف الإنشاء والحذف،
     * updatedAt يكشف التعديلات.
     */
    const visitorsRevision = [
      assignment.eventId,
      visitorsCount,
      visitorsUpdatedAt ?? 'EMPTY',
    ].join(':');

    const formattedBadgeTemplate = this.formatOfflineBadgeTemplate(
      badgeTemplate,
      requestBaseUrl,
    );

    const badgeTemplateRevision = badgeTemplate
      ? [
          badgeTemplate.id,
          badgeTemplate.updatedAt.toISOString(),
          badgeTemplate.isActive ? 'ACTIVE' : 'INACTIVE',
        ].join(':')
      : 'NO_BADGE_TEMPLATE';

    return {
      eventId: assignment.eventId,

      visitorsRevision,
      visitorsCount,
      visitorsUpdatedAt,

      badgeTemplateRevision,
      badgeTemplate: formattedBadgeTemplate,

      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Snapshot ثابت لجميع زوار فعالية الموظف.
   *
   * خصائصه:
   * - لا يعتمد على page/skip.
   * - يستخدم updatedAt + id كـCursor ثابت.
   * - يثبت snapshotAsOf في أول طلب.
   * - لا يولد صور QR.
   * - لا يولد Badge لكل زائر.
   * - لا ينفذ N+1 queries.
   */
  async findOfflineSnapshotForStaff(
    userId: string,
    query: StaffOfflineSnapshotQueryDto,
    requestBaseUrl?: string,
  ) {
    const assignment = await this.findActiveStaffAssignment(userId);

    const badgeTemplate =
      await this.badgeTemplatesService.findActiveTemplateOrNull(
        assignment.eventId,
      );

    const limit = Math.min(Math.max(query.limit || 500, 50), 500);

    const decodedCursor = query.cursor
      ? this.decodeOfflineSnapshotCursor(query.cursor)
      : null;

    if (decodedCursor && decodedCursor.eventId !== assignment.eventId) {
      throw new BadRequestException(
        'Offline snapshot cursor belongs to a different event',
      );
    }

    const snapshotAsOf = decodedCursor
      ? this.parseCursorDate(
          decodedCursor.snapshotAsOf,
          'Invalid snapshotAsOf inside offline snapshot cursor',
        )
      : new Date();

    const cursorCreatedAt = decodedCursor
      ? this.parseCursorDate(
          decodedCursor.createdAt,
          'Invalid createdAt inside offline snapshot cursor',
        )
      : null;

    const cursorWhere: Prisma.RegistrationWhereInput | undefined =
      decodedCursor && cursorCreatedAt
        ? {
            OR: [
              {
                createdAt: {
                  gt: cursorCreatedAt,
                },
              },
              {
                createdAt: cursorCreatedAt,
                id: {
                  gt: decodedCursor.id,
                },
              },
            ],
          }
        : undefined;

    const where: Prisma.RegistrationWhereInput = {
      eventId: assignment.eventId,

      /*
       * نثبت التسجيلات التي أُنشئت قبل بداية Snapshot.
       *
       * تعديل بيانات الزائر أثناء التنزيل لن يجعله
       * يختفي من الصفحات التالية.
       */
      createdAt: {
        lte: snapshotAsOf,
      },

      ...(cursorWhere ?? {}),
    };

    const isFirstPage = !decodedCursor;

    const fetchRows = () =>
      this.prisma.registration.findMany({
        where,

        /*
         * عنصر إضافي لمعرفة وجود صفحة لاحقة.
         */
        take: limit + 1,

        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],

        select: {
          id: true,
          publicId: true,

          status: true,
          source: true,

          attendeeTypeId: true,

          fullName: true,
          phone: true,
          email: true,

          companyName: true,
          jobTitle: true,
          externalId: true,

          customFields: true,
          notes: true,

          registeredAt: true,
          syncedAt: true,
          createdAt: true,
          updatedAt: true,

          attendeeType: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
            },
          },

          qrToken: {
            select: {
              id: true,
              tokenId: true,

              /*
               * ضروري لإعادة بناء Full Signed QR
               * بدون استدعاء generate لكل زائر.
               */
              payload: true,

              status: true,
              validFrom: true,
              validUntil: true,
              generatedAt: true,
              updatedAt: true,
            },
          },
        },
      });

    type OfflineSnapshotRows = Awaited<ReturnType<typeof fetchRows>>;

    let rows: OfflineSnapshotRows;
    let totalCount: number | null = null;

    if (isFirstPage) {
      [rows, totalCount] = await this.prisma.$transaction([
        fetchRows(),

        this.prisma.registration.count({
          where: {
            eventId: assignment.eventId,

            createdAt: {
              lte: snapshotAsOf,
            },
          },
        }),
      ]);
    } else {
      rows = await fetchRows();
    }

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const lastItem = items.at(-1);

    const nextCursor =
      hasMore && lastItem
        ? this.encodeOfflineSnapshotCursor({
            version: 2,
            eventId: assignment.eventId,
            snapshotAsOf: snapshotAsOf.toISOString(),
            createdAt: lastItem.createdAt.toISOString(),
            id: lastItem.id,
          })
        : null;

    return {
      snapshot: {
        version: 2,

        /*
         * Snapshot ID ثابت لكل صفحات نفس عملية التنزيل.
         */
        id: this.createSnapshotId(
          assignment.eventId,
          snapshotAsOf.toISOString(),
        ),

        eventId: assignment.eventId,
        snapshotAsOf: snapshotAsOf.toISOString(),

        pageSize: limit,
        returnedCount: items.length,

        totalCount,
        hasMore,
        nextCursor,
      },

      event: {
        id: assignment.event.id,
        titleAr: assignment.event.titleAr,
        titleEn: assignment.event.titleEn,
        startsAt: assignment.event.startsAt,
        endsAt: assignment.event.endsAt,
        timezone: assignment.event.timezone,
        updatedAt: assignment.event.updatedAt,
      },

      badgeTemplate: this.formatOfflineBadgeTemplate(
        badgeTemplate,
        requestBaseUrl,
      ),

      visitors: items.map((visitor) => {
        const qr = this.formatOfflineQr(visitor.qrToken);

        return {
          id: visitor.id,
          publicId: visitor.publicId,

          status: visitor.status,
          source: visitor.source,

          attendeeTypeId: visitor.attendeeTypeId,
          attendeeType: visitor.attendeeType,

          fullName: visitor.fullName,
          phone: visitor.phone,
          email: visitor.email,

          companyName: visitor.companyName,
          jobTitle: visitor.jobTitle,
          externalId: visitor.externalId,

          customFields: visitor.customFields ?? {},
          notes: visitor.notes,

          registeredAt: visitor.registeredAt,
          syncedAt: visitor.syncedAt,
          createdAt: visitor.createdAt,
          updatedAt: visitor.updatedAt,

          /*
           * تسهيل القراءة في الفرونت ودعم النسخ المختلفة.
           */
          qrToken: qr?.qrToken ?? null,
          canonicalQrToken: qr?.qrToken ?? null,

          qr,
        };
      }),
    };
  }

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
          select: {
            id: true,
            titleAr: true,
            titleEn: true,
          },
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

        updatedAt: true,
      },
    });

    if (!registration || registration.eventId !== assignment.eventId) {
      throw new NotFoundException('Registration not found');
    }

    if (dto.expectedUpdatedAt) {
      const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);

      if (
        Number.isNaN(expectedUpdatedAt.getTime()) ||
        expectedUpdatedAt.getTime() !== registration.updatedAt.getTime()
      ) {
        throw new ConflictException({
          code: 'VISITOR_UPDATE_CONFLICT',
          message:
            'Visitor data was modified after the offline copy was downloaded',
          currentUpdatedAt: registration.updatedAt.toISOString(),
        });
      }
    }

    const { expectedUpdatedAt: _expectedUpdatedAt, ...updatePayload } = dto;

    const updatedRegistration = await this.registrationsService.update(
      registrationId,
      updatePayload,
    );

    await this.auditStaffVisitorUpdate(userId, registration, updatePayload);

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
        orderBy: {
          registeredAt: 'desc',
        },
        select: {
          id: true,
          publicId: true,

          ...(includeQrMetadata
            ? {
                eventId: true,
                attendeeTypeId: true,
              }
            : {}),

          ...(includeEvent
            ? {
                eventId: true,
              }
            : {}),

          status: true,

          ...(includeQrMetadata
            ? {
                source: true,
              }
            : {}),

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

          ...(includeQrMetadata
            ? {
                createdAt: true,
                updatedAt: true,
              }
            : {}),

          ...(includeEvent
            ? {
                event: {
                  select: {
                    id: true,
                    titleAr: true,
                    titleEn: true,
                  },
                },
              }
            : {}),

          attendeeType: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
            },
          },
        },
      }),

      this.prisma.registration.count({
        where,
      }),
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
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        event: {
          select: {
            id: true,
            titleAr: true,
            titleEn: true,
            startsAt: true,
            endsAt: true,
            timezone: true,
            updatedAt: true,
          },
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
    visitor: {
      id: string;
      publicId: string;
    },
    requestBaseUrl?: string,
  ) {
    try {
      const qr = await this.qrService.generate(visitor.id);

      const existingImage =
        await this.qrImageService.getRegistrationQrImageMetadata({
          registrationPublicId: visitor.publicId,

          /*
           * مهم حتى يختار الصورة الخاصة بنفس التوكن.
           */
          qrToken: qr.qrToken,

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
    qr: {
      qrToken: string;
      imageUrl: string;
      relativePath: string;
    } | null,
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
      ...(eventId
        ? {
            eventId,
          }
        : {}),

      ...(query.attendeeTypeId
        ? {
            attendeeTypeId: query.attendeeTypeId,
          }
        : {}),

      ...(query.status
        ? {
            status: query.status,
          }
        : {}),

      ...(query.fullName
        ? {
            fullName: {
              contains: query.fullName,
            },
          }
        : {}),

      ...(query.phone
        ? {
            phone: {
              contains: query.phone,
            },
          }
        : {}),

      ...(query.email
        ? {
            email: {
              contains: query.email,
            },
          }
        : {}),

      ...(query.search
        ? {
            OR: [
              {
                fullName: {
                  contains: query.search,
                },
              },
              {
                phone: {
                  contains: query.search,
                },
              },
              {
                email: {
                  contains: query.search,
                },
              },
              {
                publicId: {
                  contains: query.search,
                },
              },
            ],
          }
        : {}),
    };
  }

  private encodeOfflineSnapshotCursor(cursor: StaffOfflineSnapshotCursor) {
    const json = JSON.stringify(cursor);

    return Buffer.from(json, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private decodeOfflineSnapshotCursor(
    encodedCursor: string,
  ): StaffOfflineSnapshotCursor {
    try {
      const normalized = encodedCursor
        .trim()
        .replace(/-/g, '+')
        .replace(/_/g, '/');

      const paddingLength = (4 - (normalized.length % 4)) % 4;
      const padded = `${normalized}${'='.repeat(paddingLength)}`;

      const json = Buffer.from(padded, 'base64').toString('utf8');

      const parsed = JSON.parse(json) as Partial<StaffOfflineSnapshotCursor>;

      if (
        parsed.version !== 2 ||
        typeof parsed.eventId !== 'string' ||
        typeof parsed.snapshotAsOf !== 'string' ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        parsed.eventId.trim().length === 0 ||
        parsed.id.trim().length === 0
      ) {
        throw new Error('Invalid cursor structure');
      }

      return {
        version: 2,
        eventId: parsed.eventId,
        snapshotAsOf: parsed.snapshotAsOf,
        createdAt: parsed.createdAt,
        id: parsed.id,
      };
    } catch {
      throw new BadRequestException('Invalid offline snapshot cursor');
    }
  }

  private parseCursorDate(value: string, errorMessage: string) {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(errorMessage);
    }

    return parsed;
  }

  private createSnapshotId(eventId: string, snapshotAsOf: string) {
    return this.encodeOfflineSnapshotCursor({
      version: 2,
      eventId,
      snapshotAsOf,
      createdAt: snapshotAsOf,
      id: 'snapshot',
    });
  }

  private formatOfflineQr(
    qrToken: {
      id: string;
      tokenId: string;
      payload: Prisma.JsonValue;
      status: string;
      validFrom: Date;
      validUntil: Date;
      generatedAt: Date;
      updatedAt: Date;
    } | null,
  ) {
    if (!qrToken) {
      return null;
    }

    const compactQrToken = this.qrService.createCompactTokenForOffline(
      qrToken.tokenId,
    );

    let signedQrToken: string | null = null;

    try {
      signedQrToken = this.qrService.createSignedTokenForOfflineSnapshot(
        qrToken.payload,
        qrToken.tokenId,
      );
    } catch (error) {
      this.logger.warn(
        `Could not reconstruct signed QR for token ${qrToken.tokenId}: ${
          error instanceof Error ? error.message : 'Unknown QR payload error'
        }`,
      );
    }

    return {
      id: qrToken.id,
      tokenId: qrToken.tokenId,

      /*
       * الرمز الأساسي للطباعة والمسح.
       */
      qrToken: compactQrToken,
      token: compactQrToken,
      value: compactQrToken,

      /*
       * الاحتفاظ بالرمز الكامل للتوافق والتحقق،
       * لكنه ليس الرمز المستخدم في صورة QR.
       */
      signedToken: signedQrToken,
      compactQrToken,

      status: qrToken.status,

      validFrom: qrToken.validFrom,
      validUntil: qrToken.validUntil,

      generatedAt: qrToken.generatedAt,
      updatedAt: qrToken.updatedAt,

      imageUrl: null,
      relativePath: null,
    };
  }

  private formatOfflineBadgeTemplate(
    template: EventBadgeTemplate | null,
    requestBaseUrl?: string,
  ) {
    if (!template) {
      return null;
    }

    const backgroundImageRelativePath =
      template.backgroundImageUrl?.trim() || null;

    return {
      id: template.id,
      eventId: template.eventId,
      name: template.name,

      widthMm: template.widthMm,
      heightMm: template.heightMm,

      backgroundImageUrl: this.resolvePublicAssetUrl(
        backgroundImageRelativePath,
        requestBaseUrl,
      ),

      backgroundImageRelativePath,

      colors: template.colors,
      layout: template.layout,
      selectedFields: template.selectedFields,

      isActive: template.isActive,

      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private resolvePublicAssetUrl(path: string | null, requestBaseUrl?: string) {
    if (!path) {
      return null;
    }

    if (
      path.startsWith('data:') ||
      path.startsWith('blob:') ||
      path.startsWith('http://') ||
      path.startsWith('https://')
    ) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const normalizedBaseUrl = requestBaseUrl?.trim().replace(/\/+$/, '');

    if (!normalizedBaseUrl) {
      return normalizedPath;
    }

    return `${normalizedBaseUrl}${normalizedPath}`;
  }
}
