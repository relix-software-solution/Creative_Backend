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
import { StaffVisitorChangesQueryDto } from './dto/staff-visitor-changes-query.dto';
import { UpdateStaffVisitorDto } from './dto/update-staff-visitor.dto';

type StaffOfflineSnapshotCursor = {
  version: 2 | 3;
  eventId: string;
  snapshotAsOf: string;
  createdAt: string;
  id: string;
  changeCursor?: string;
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

    const [badgeTemplate, visitorsAggregate, latestChange] = await Promise.all([
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

      this.prisma.visitorChange.aggregate({
        where: { eventId: assignment.eventId },
        _max: { id: true },
      }),
    ]);

    const visitorsCount = visitorsAggregate._count._all;

    const visitorsUpdatedAt =
      visitorsAggregate._max.updatedAt?.toISOString() ?? null;

    /*
     * Durable monotonic revision. It changes for create/update/delete and is
     * safe to use as a delta cursor across reconnects.
     */
    const visitorsRevision = (latestChange._max.id ?? 0n).toString();

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

    const snapshotChangeCursor =
      decodedCursor?.changeCursor ??
      (await this.getLatestVisitorChangeCursorAt(
        assignment.eventId,
        snapshotAsOf,
      ));

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
            version: 3,
            eventId: assignment.eventId,
            snapshotAsOf: snapshotAsOf.toISOString(),
            createdAt: lastItem.createdAt.toISOString(),
            id: lastItem.id,
            changeCursor: snapshotChangeCursor,
          })
        : null;

    return {
      snapshot: {
        version: 3,

        /*
         * Snapshot ID ثابت لكل صفحات نفس عملية التنزيل.
         */
        id: this.createSnapshotId(
          assignment.eventId,
          snapshotAsOf.toISOString(),
        ),

        eventId: assignment.eventId,
        snapshotAsOf: snapshotAsOf.toISOString(),
        changeCursor: snapshotChangeCursor,

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

      visitors: items.map((visitor) => this.formatOfflineVisitor(visitor)),
    };
  }


  async findChangesForStaff(
    userId: string,
    query: StaffVisitorChangesQueryDto,
  ) {
    const assignment = await this.findActiveStaffAssignment(userId);
    const after = this.parseVisitorChangeCursor(query.after);
    const limit = Math.min(Math.max(query.limit || 500, 1), 1000);

    const rows = await this.prisma.visitorChange.findMany({
      where: {
        eventId: assignment.eventId,
        id: { gt: after },
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    /*
     * Registration creation and QR creation can produce two adjacent UPSERT
     * journal rows. Keep only the newest operation for each registration in
     * this page while advancing the cursor over every durable journal row.
     */
    const latestChangeByRegistration = new Map<
      string,
      (typeof pageRows)[number]
    >();

    for (const change of pageRows) {
      latestChangeByRegistration.set(change.registrationId, change);
    }

    const effectiveRows = [...latestChangeByRegistration.values()].sort(
      (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );

    const registrationIds = [
      ...new Set(
        effectiveRows
          .filter((change) => change.operation === 'UPSERT')
          .map((change) => change.registrationId),
      ),
    ];

    const registrations = registrationIds.length
      ? await this.prisma.registration.findMany({
          where: {
            eventId: assignment.eventId,
            id: { in: registrationIds },
          },
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
                status: true,
                validFrom: true,
                validUntil: true,
                generatedAt: true,
                updatedAt: true,
              },
            },
          },
        })
      : [];

    const registrationsById = new Map(
      registrations.map((registration) => [registration.id, registration]),
    );

    const [latestChange, visitorsCount] = await Promise.all([
      this.prisma.visitorChange.aggregate({
        where: { eventId: assignment.eventId },
        _max: { id: true },
      }),
      this.prisma.registration.count({
        where: { eventId: assignment.eventId },
      }),
    ]);

    const nextCursor =
      pageRows.at(-1)?.id.toString() ?? after.toString();
    const latestCursor = (latestChange._max.id ?? 0n).toString();

    /*
     * A change may commit between the page query and the aggregate query.
     * Keep hasMore=true until the returned cursor actually reaches the latest
     * durable cursor, preventing a missed realtime registration.
     */
    const moreChangesAvailable =
      hasMore || BigInt(nextCursor) < BigInt(latestCursor);

    return {
      eventId: assignment.eventId,
      afterCursor: after.toString(),
      nextCursor,
      latestCursor,
      hasMore: moreChangesAvailable,
      visitorsCount,
      changes: effectiveRows.map((change) => {
        const registration = registrationsById.get(change.registrationId);

        return {
          cursor: change.id.toString(),
          operation: change.operation,
          registrationId: change.registrationId,
          changedAt: change.changedAt.toISOString(),
          visitor:
            change.operation === 'UPSERT' && registration
              ? this.formatOfflineVisitor(registration)
              : null,
        };
      }),
    };
  }

  async findForStaff(
    userId: string,
    query: ListVisitorsQueryDto,
    _requestBaseUrl?: string,
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

    /*
     * Staff search must stay lightweight. It returns the canonical compact QR
     * already stored in the database and never regenerates QR images or badge
     * payloads for every search result. Badge preview is assembled locally
     * from the cached template, while the explicit /:registrationId/qr route
     * remains available when a registration genuinely has no QR yet.
     */
    const visitors = await this.findVisitors(query, assignment.eventId, {
      includeQrMetadata: true,
    });

    return {
      event: assignment.event,
      visitors,
    };
  }

  async findForAdmin(query: ListAdminVisitorsQueryDto) {
    return this.findVisitors(query, query.eventId, true);
  }

  async generateQrForStaff(
    userId: string,
    registrationId: string,
    requestBaseUrl?: string,
  ) {
    const assignment = await this.findActiveStaffAssignment(userId);

    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        publicId: true,
        eventId: true,
        status: true,
        fullName: true,
      },
    });

    if (!registration || registration.eventId !== assignment.eventId) {
      throw new NotFoundException('Registration not found');
    }

    const qr = await this.qrService.generate(registration.id);

    const existingImage =
      await this.qrImageService.getRegistrationQrImageMetadata({
        registrationPublicId: registration.publicId,
        qrToken: qr.qrToken,
        requestBaseUrl,
      });

    const image =
      existingImage ??
      (await this.qrImageService.generateRegistrationQrImage({
        registrationPublicId: registration.publicId,
        qrToken: qr.qrToken,
        requestBaseUrl,
      }));

    return {
      registrationId: registration.id,
      qrToken: qr.qrToken,
      compactQrToken: qr.compactQrToken,
      signedToken: qr.signedQrToken,
      imageUrl: image.publicUrl,
      publicUrl: image.publicUrl,
      relativePath: image.relativePath,
      status: qr.status,
      validFrom: qr.validFrom,
      validUntil: qr.validUntil,
      qr: {
        qrToken: qr.qrToken,
        compactQrToken: qr.compactQrToken,
        signedToken: qr.signedQrToken,
        imageUrl: image.publicUrl,
        publicUrl: image.publicUrl,
        relativePath: image.relativePath,
        status: qr.status,
        validFrom: qr.validFrom,
        validUntil: qr.validUntil,
      },
      registration: {
        id: registration.id,
        publicId: registration.publicId,
        fullName: registration.fullName,
        status: registration.status,
      },
    };
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

          ...(includeQrMetadata
            ? {
                qrToken: {
                  select: {
                    id: true,
                    tokenId: true,
                    status: true,
                    validFrom: true,
                    validUntil: true,
                    generatedAt: true,
                    updatedAt: true,
                  },
                },
              }
            : {}),
        },
      }),

      this.prisma.registration.count({
        where,
      }),
    ]);

    if (includeQrMetadata) {
      return createPaginatedResponse(
        items.map((item) => this.formatOfflineVisitor(item)),
        total,
        page,
        limit,
      );
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
        (parsed.version !== 2 && parsed.version !== 3) ||
        typeof parsed.eventId !== 'string' ||
        typeof parsed.snapshotAsOf !== 'string' ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        parsed.eventId.trim().length === 0 ||
        parsed.id.trim().length === 0 ||
        (parsed.changeCursor !== undefined &&
          !/^\d+$/.test(parsed.changeCursor))
      ) {
        throw new Error('Invalid cursor structure');
      }

      return {
        version: parsed.version,
        eventId: parsed.eventId,
        snapshotAsOf: parsed.snapshotAsOf,
        createdAt: parsed.createdAt,
        id: parsed.id,
        changeCursor: parsed.changeCursor,
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
      version: 3,
      eventId,
      snapshotAsOf,
      createdAt: snapshotAsOf,
      id: 'snapshot',
      changeCursor: '0',
    });
  }


  private parseVisitorChangeCursor(value?: string) {
    const normalized = value?.trim() || '0';

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('after must be a non-negative integer');
    }

    return BigInt(normalized);
  }

  private async getLatestVisitorChangeCursorAt(
    eventId: string,
    snapshotAsOf: Date,
  ) {
    const aggregate = await this.prisma.visitorChange.aggregate({
      where: {
        eventId,
        changedAt: { lte: snapshotAsOf },
      },
      _max: { id: true },
    });

    return (aggregate._max.id ?? 0n).toString();
  }

  private formatOfflineVisitor(visitor: any) {
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
      qrToken: qr?.qrToken ?? null,
      canonicalQrToken: qr?.qrToken ?? null,
      qr,
    };
  }

  private formatOfflineQr(
    qrToken: {
      id: string;
      tokenId: string;
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
       * لا نرسل Full Signed QR داخل الـsnapshot لأنه كبير وغير مطلوب
       * للتحقق؛ Compact Q2 هو الرمز الرسمي المطبوع والممسوح.
       */
      signedToken: null,
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
