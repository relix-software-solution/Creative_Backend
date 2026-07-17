import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Checkpoint,
  Device,
  DeviceStatus,
  Event,
  EventStatus,
  MovementResult,
  MovementType,
  OfflineScanOperation,
  OfflineScanOperationStatus,
  Prisma,
  QrToken,
  QrTokenStatus,
  Registration,
  RegistrationStatus,
  ScanEventStatus,
  StaffSession,
  StaffSessionStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  verifyCompactQrToken,
  verifySignedQrToken,
} from '../../common/utils/qr-signing.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { BadgeTemplatesService } from '../badge-templates/badge-templates.service';
import {
  OfflineQrService,
  VerifiedOfflineQr,
} from '../offline/offline-qr.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { QrImageService } from '../qr/qr-image.service';
import { QrService } from '../qr/qr.service';
import { CreateScanDto } from './dto/create-scan.dto';
import { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import { ListRawScansQueryDto } from './dto/list-raw-scans-query.dto';

type ValidQrContext = {
  qrToken: QrToken;
  registration: Registration & {
    attendeeType: {
      id: string;
      code: string;
      nameAr: string;
      nameEn: string | null;
    };
  };
  payload: Record<string, unknown>;
};

type PendingOfflineQrContext = {
  valid: false;
  pendingOffline: true;
  reason: 'OFFLINE_QR_PENDING_SYNC';
  verifiedOfflineQr: VerifiedOfflineQr;
};

@Injectable()
export class ScansService {
  private readonly logger = new Logger(ScansService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.SCAN_PROCESSING)
    private readonly scanProcessingQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly badgeTemplatesService: BadgeTemplatesService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
    private readonly offlineQrService: OfflineQrService,
  ) {}

  async ingest(createScanDto: CreateScanDto) {
    const existingScan = await this.prisma.scanEventRaw.findUnique({
      where: { operationId: createScanDto.operationId },
      include: this.rawScanInclude,
    });

    if (existingScan) {
      if (
        existingScan.status === ScanEventStatus.PROCESSED ||
        existingScan.status === ScanEventStatus.INVALID_QR
      ) {
        return {
          duplicate: true,
          ...(await this.formatScanResponse({
            allowed: existingScan.result === MovementResult.ALLOWED,
            reason: existingScan.reason ?? 'DUPLICATE_SCAN',
            scanEvent: existingScan,
            movement: existingScan.movementLog,
            generateQrImage: true,
          })),
        };
      }

      return { duplicate: true, scanEvent: existingScan };
    }

    const event = await this.ensureEventCanBeModified(createScanDto.eventId);
    const device = await this.ensureActiveDevice(
      createScanDto.deviceId,
      createScanDto.eventId,
    );
    const staffSession = await this.ensureActiveStaffSession(
      createScanDto.staffSessionId,
      createScanDto.eventId,
    );
    const checkpoint = await this.ensureActiveCheckpoint(
      createScanDto.checkpointId,
      createScanDto.eventId,
    );
    const scannedAtDevice = new Date(createScanDto.scannedAtDevice);
    const qrContext = await this.validateQrForScan(
      createScanDto.qrToken,
      createScanDto.eventId,
    );

    if (!qrContext.valid) {
      if ('pendingOffline' in qrContext) {
        const offlineScan = await this.createPendingOfflineScanFromOnlineScan(
          createScanDto,
          scannedAtDevice,
          qrContext.verifiedOfflineQr,
        );

        await this.touchActivity(device.id, staffSession?.id);

        return {
          allowed: true,
          provisional: true,
          reason: qrContext.reason,
          offlineScanOperationId: offlineScan.id,
          registration: null,
          qr: {
            inputType: 'OFFLINE_SIGNED',
            offlineQrToken: qrContext.verifiedOfflineQr.payload.offlineQrToken,
            verified: true,
          },
        };
      }

      const reason = this.toScanDenialReason(qrContext.reason);
      const scanEvent = await this.createInvalidScan(
        createScanDto,
        scannedAtDevice,
        reason,
        qrContext.payload,
        qrContext.qrTokenId,
        qrContext.registrationId,
      );

      await this.touchActivity(device.id, staffSession?.id);

      return this.formatScanResponse({
        allowed: false,
        reason,
        scanEvent,
        movement: null,
        generateQrImage: true,
      });
    }

    const accessReason = this.getCheckpointAccessDenial(
      checkpoint,
      qrContext.registration.attendeeType.code,
    );
    const reentryReason = await this.getReentryDenial(
      event,
      qrContext.registration.id,
      createScanDto.type,
    );
    const reason = accessReason ?? reentryReason ?? 'ALLOWED';
    const result =
      reason === 'ALLOWED' ? MovementResult.ALLOWED : MovementResult.DENIED;

    const { scanEvent, movement } = await this.createProcessedScanAndMovement(
      createScanDto,
      scannedAtDevice,
      qrContext,
      result,
      reason,
    );

    await this.touchActivity(device.id, staffSession?.id);

    return this.formatScanResponse({
      allowed: result === MovementResult.ALLOWED,
      reason,
      scanEvent,
      movement,
      generateQrImage: true,
    });
  }

  async ingestFast(createScanDto: CreateScanDto) {
    const existingScan = await this.prisma.scanEventRaw.findUnique({
      where: { operationId: createScanDto.operationId },
    });

    if (existingScan) {
      return {
        accepted: true,
        duplicate: true,
        scanEventId: existingScan.id,
        status: existingScan.status,
      };
    }

    const scanEvent = await this.prisma.scanEventRaw.create({
      data: {
        operationId: createScanDto.operationId,
        eventId: createScanDto.eventId,
        deviceId: createScanDto.deviceId,
        staffSessionId: createScanDto.staffSessionId,
        checkpointId: createScanDto.checkpointId,
        qrRaw: createScanDto.qrToken,
        type: createScanDto.type,
        status: ScanEventStatus.PENDING,
        scannedAtDevice: new Date(createScanDto.scannedAtDevice),
        payload:
          createScanDto.payload === undefined
            ? Prisma.JsonNull
            : (createScanDto.payload as Prisma.InputJsonValue),
      },
    });

    if (!this.configService.get<boolean>('SCAN_PROCESSING_ENABLED', true)) {
      return {
        accepted: true,
        queued: false,
        scanEventId: scanEvent.id,
        status: scanEvent.status,
      };
    }

    try {
      await this.scanProcessingQueue.add(
        'scan.process',
        { scanEventRawId: scanEvent.id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        },
      );

      return {
        accepted: true,
        queued: true,
        scanEventId: scanEvent.id,
        status: scanEvent.status,
      };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue scan processing for ${scanEvent.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        accepted: true,
        queued: false,
        scanEventId: scanEvent.id,
        status: scanEvent.status,
      };
    }
  }

  async processRawScan(scanEventRawId: string) {
    const scanEvent = await this.prisma.scanEventRaw.findUnique({
      where: { id: scanEventRawId },
    });

    if (!scanEvent) {
      return { scanEventRawId, skippedReason: 'SCAN_EVENT_NOT_FOUND' };
    }

    if (scanEvent.status !== ScanEventStatus.PENDING) {
      return {
        scanEventRawId,
        status: scanEvent.status,
        skippedReason: 'SCAN_EVENT_NOT_PENDING',
      };
    }

    try {
      const event = await this.ensureEventCanBeModified(scanEvent.eventId);
      const device = await this.ensureActiveDevice(
        scanEvent.deviceId,
        scanEvent.eventId,
      );
      const staffSession = await this.ensureActiveStaffSession(
        scanEvent.staffSessionId ?? undefined,
        scanEvent.eventId,
      );
      const checkpoint = await this.ensureActiveCheckpoint(
        scanEvent.checkpointId ?? undefined,
        scanEvent.eventId,
      );
      const qrContext = await this.validateQrForScan(
        scanEvent.qrRaw ?? '',
        scanEvent.eventId,
      );

      if (!qrContext.valid) {
        if ('pendingOffline' in qrContext) {
          if (!scanEvent.checkpointId) {
            throw new BadRequestException('Offline scans require a checkpoint');
          }

          await this.createPendingOfflineScanFromOnlineScan(
            {
              operationId: scanEvent.operationId,
              eventId: scanEvent.eventId,
              deviceId: scanEvent.deviceId,
              staffSessionId: scanEvent.staffSessionId ?? undefined,
              checkpointId: scanEvent.checkpointId,
              qrToken: scanEvent.qrRaw ?? '',
              type: scanEvent.type,
              scannedAtDevice: scanEvent.scannedAtDevice.toISOString(),
              payload:
                scanEvent.payload &&
                typeof scanEvent.payload === 'object' &&
                !Array.isArray(scanEvent.payload)
                  ? (scanEvent.payload as Record<string, unknown>)
                  : undefined,
            },
            scanEvent.scannedAtDevice,
            qrContext.verifiedOfflineQr,
          );
          const updatedScanEvent = await this.prisma.scanEventRaw.update({
            where: { id: scanEvent.id },
            data: {
              status: ScanEventStatus.FAILED,
              result: MovementResult.WARNING,
              reason: qrContext.reason,
              processedAt: new Date(),
            },
            include: this.rawScanInclude,
          });

          await this.touchActivity(device.id, staffSession?.id);

          return {
            allowed: true,
            provisional: true,
            reason: qrContext.reason,
            scanEvent: updatedScanEvent,
          };
        }

        const reason = this.toScanDenialReason(qrContext.reason);
        const updatedScanEvent = await this.updateInvalidRawScan(
          scanEvent.id,
          reason,
          qrContext.payload,
          qrContext.qrTokenId,
          qrContext.registrationId,
        );

        await this.touchActivity(device.id, staffSession?.id);

        return this.formatScanResponse({
          allowed: false,
          scanEvent: updatedScanEvent,
          movement: null,
          reason,
          generateQrImage: false,
        });
      }

      const accessReason = this.getCheckpointAccessDenial(
        checkpoint,
        qrContext.registration.attendeeType.code,
      );
      const reentryReason = await this.getReentryDenial(
        event,
        qrContext.registration.id,
        scanEvent.type,
      );
      const reason = accessReason ?? reentryReason ?? 'ALLOWED';
      const result =
        reason === 'ALLOWED' ? MovementResult.ALLOWED : MovementResult.DENIED;
      const { updatedScanEvent, movement } =
        await this.updateRawScanAndCreateMovement(
          scanEvent,
          qrContext,
          result,
          reason,
        );

      await this.touchActivity(device.id, staffSession?.id);

      return this.formatScanResponse({
        scanEvent: updatedScanEvent,
        movement,
        allowed: result === MovementResult.ALLOWED,
        reason,
        generateQrImage: false,
      });
    } catch (error) {
      const updatedScanEvent = await this.prisma.scanEventRaw.update({
        where: { id: scanEvent.id },
        data: {
          status: ScanEventStatus.FAILED,
          result: MovementResult.DENIED,
          reason:
            error instanceof Error ? error.message : 'SCAN_PROCESSING_FAILED',
          processedAt: new Date(),
        },
      });

      return {
        scanEvent: updatedScanEvent,
        result: MovementResult.DENIED,
        reason: updatedScanEvent.reason,
      };
    }
  }

  async ingestOfflineScan(input: {
    operationId: string;
    eventId: string;
    scannerDeviceId: string;
    staffSessionId?: string;
    checkpointId: string;
    signedOfflineQr: string;
    offlineQrToken?: string;
    offlineRegistrationOperationId?: string;
    movementType: MovementType;
    scannedAtDevice: string;
    localResult?: string;
  }) {
    const verified = await this.offlineQrService.verifySignedOfflineQr(
      input.signedOfflineQr,
      input.eventId,
    );
    const offlineQrToken =
      input.offlineQrToken ?? verified.payload.offlineQrToken;

    if (
      !this.offlineQrService.tokensEqual(
        offlineQrToken,
        verified.payload.offlineQrToken,
      )
    ) {
      throw new BadRequestException('Offline scan token mismatch');
    }

    await this.ensureEventCanBeModified(input.eventId);
    await this.ensureActiveDevice(input.scannerDeviceId, input.eventId);
    await this.ensureActiveStaffSession(input.staffSessionId, input.eventId);
    await this.ensureActiveCheckpoint(input.checkpointId, input.eventId);

    const existing = await this.prisma.offlineScanOperation.findUnique({
      where: { operationId: input.operationId },
    });

    if (existing) {
      if (existing.qrPayloadHash !== verified.payloadHash) {
        const conflicted = await this.prisma.offlineScanOperation.update({
          where: { id: existing.id },
          data: {
            status: OfflineScanOperationStatus.CONFLICTED,
            conflictCode: 'OFFLINE_SCAN_CONFLICT',
            conflictMessage:
              'Same offline scan operationId was submitted with a different signed QR payload',
          },
        });

        return { status: 'CONFLICT', offlineScanOperation: conflicted };
      }

      if (existing.status === OfflineScanOperationStatus.PENDING_LINK) {
        return {
          status: OfflineScanOperationStatus.PENDING_LINK,
          offlineScanOperation: existing,
        };
      }

      return {
        status: existing.status,
        duplicate: true,
        offlineScanOperation: existing,
      };
    }

    const mapping = await this.prisma.offlineRegistrationMapping.findUnique({
      where: { offlineQrToken },
    });
    const offlineScan = await this.prisma.offlineScanOperation.create({
      data: {
        operationId: input.operationId,
        eventId: input.eventId,
        scannerDeviceId: input.scannerDeviceId,
        checkpointId: input.checkpointId,
        staffSessionId: input.staffSessionId,
        offlineQrToken,
        offlineRegistrationOperationId:
          input.offlineRegistrationOperationId ??
          verified.payload.offlineRegistrationOperationId,
        issuerDeviceId: verified.payload.issuerDeviceId,
        issuerKeyVersion: verified.payload.issuerKeyVersion,
        scannedAtDevice: new Date(input.scannedAtDevice),
        movementType: input.movementType,
        localResult: input.localResult,
        qrPayload: verified.payload as unknown as Prisma.InputJsonValue,
        qrPayloadHash: verified.payloadHash,
        status: mapping?.registrationId
          ? OfflineScanOperationStatus.LINKED
          : OfflineScanOperationStatus.PENDING_LINK,
        registrationId: mapping?.registrationId,
        syncedAt: new Date(),
      },
    });

    if (!mapping?.registrationId) {
      return {
        status: OfflineScanOperationStatus.PENDING_LINK,
        offlineScanOperation: offlineScan,
      };
    }

    return this.processOfflineScanOperation(offlineScan.id);
  }

  async reconcileOfflineRegistration(input: {
    eventId: string;
    offlineQrToken: string;
    offlineRegistrationOperationId: string;
    registrationId: string;
  }) {
    const pendingScans = await this.prisma.offlineScanOperation.findMany({
      where: {
        eventId: input.eventId,
        status: OfflineScanOperationStatus.PENDING_LINK,
        OR: [
          { offlineQrToken: input.offlineQrToken },
          {
            offlineRegistrationOperationId:
              input.offlineRegistrationOperationId,
          },
        ],
      },
      orderBy: { scannedAtDevice: 'asc' },
    });

    const results: Array<Record<string, unknown>> = [];

    for (const offlineScan of pendingScans) {
      try {
        await this.prisma.offlineScanOperation.update({
          where: { id: offlineScan.id },
          data: {
            status: OfflineScanOperationStatus.LINKED,
            registrationId: input.registrationId,
          },
        });
        results.push(await this.processOfflineScanOperation(offlineScan.id));
      } catch (error) {
        const failed = await this.prisma.offlineScanOperation.update({
          where: { id: offlineScan.id },
          data: {
            status: OfflineScanOperationStatus.FAILED,
            conflictCode: 'OFFLINE_RECONCILIATION_FAILED',
            conflictMessage:
              error instanceof Error ? error.message : 'Reconciliation failed',
          },
        });
        results.push({ status: failed.status, offlineScanOperation: failed });
      }
    }

    return {
      reconciledCount: results.length,
      results,
    };
  }

  async findRawScans(query: ListRawScansQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.ScanEventRawWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.staffSessionId ? { staffSessionId: query.staffSessionId } : {}),
      ...(query.checkpointId ? { checkpointId: query.checkpointId } : {}),
      ...(query.registrationId ? { registrationId: query.registrationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.scanEventRaw.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedAtServer: 'desc' },
        include: this.rawScanInclude,
      }),
      this.prisma.scanEventRaw.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findRawScan(id: string) {
    const scanEvent = await this.prisma.scanEventRaw.findUnique({
      where: { id },
      include: this.rawScanInclude,
    });

    if (!scanEvent) {
      throw new NotFoundException('Raw scan event not found');
    }

    return scanEvent;
  }

  async findMovements(query: ListMovementsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.MovementLogWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.registrationId ? { registrationId: query.registrationId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.staffSessionId ? { staffSessionId: query.staffSessionId } : {}),
      ...(query.checkpointId ? { checkpointId: query.checkpointId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.result ? { result: query.result } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.movementLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { occurredAt: 'desc' },
        include: this.movementInclude,
      }),
      this.prisma.movementLog.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findMovement(id: string) {
    const movement = await this.prisma.movementLog.findUnique({
      where: { id },
      include: this.movementInclude,
    });

    if (!movement) {
      throw new NotFoundException('Movement not found');
    }

    return movement;
  }

  private async validateQrForScan(qrRaw: string, eventId: string) {
    let payload: Record<string, unknown>;

    const qrSigningSecret =
      this.configService.getOrThrow<string>('QR_SIGNING_SECRET');

    try {
      payload = verifySignedQrToken(qrRaw, qrSigningSecret) as unknown as Record<
        string,
        unknown
      >;
    } catch {
      try {
        payload = verifyCompactQrToken(qrRaw, qrSigningSecret) as unknown as Record<
          string,
          unknown
        >;
      } catch {
        try {
          return await this.validateOfflineQrForScan(qrRaw, eventId);
        } catch {
          return {
            valid: false as const,
            reason: 'INVALID_SIGNATURE',
            payload: null,
          };
        }
      }
    }

    const tokenId = typeof payload.tokenId === 'string' ? payload.tokenId : '';
    const storedQrToken = await this.prisma.qrToken.findUnique({
      where: { tokenId },
      include: {
        registration: {
          include: {
            attendeeType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
          },
        },
      },
    });

    if (!storedQrToken) {
      return { valid: false as const, reason: 'TOKEN_NOT_FOUND', payload };
    }

    if (
      storedQrToken.eventId !== eventId ||
      (typeof payload.eventId === 'string' && payload.eventId !== eventId) ||
      (typeof payload.registrationId === 'string' &&
        payload.registrationId !== storedQrToken.registrationId)
    ) {
      return {
        valid: false as const,
        reason: 'EVENT_MISMATCH',
        payload,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    if (storedQrToken.status === QrTokenStatus.REVOKED) {
      return {
        valid: false as const,
        reason: 'TOKEN_REVOKED',
        payload,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    const now = new Date();
    if (
      storedQrToken.status === QrTokenStatus.EXPIRED ||
      now < storedQrToken.validFrom ||
      now > storedQrToken.validUntil
    ) {
      return {
        valid: false as const,
        reason: 'TOKEN_EXPIRED',
        payload,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    if (storedQrToken.registration.status !== RegistrationStatus.ACTIVE) {
      return {
        valid: false as const,
        reason: 'REGISTRATION_INACTIVE',
        payload,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    return {
      valid: true as const,
      qrToken: storedQrToken,
      registration: storedQrToken.registration,
      payload,
    };
  }

  private async validateOfflineQrForScan(
    qrRaw: string,
    eventId: string,
  ): Promise<
    | PendingOfflineQrContext
    | {
        valid: false;
        reason: string;
        payload: Record<string, unknown> | null;
        qrTokenId?: string;
        registrationId?: string;
      }
    | {
        valid: true;
        qrToken: ValidQrContext['qrToken'];
        registration: ValidQrContext['registration'];
        payload: Record<string, unknown>;
      }
  > {
    const verified = await this.offlineQrService.verifySignedOfflineQr(
      qrRaw,
      eventId,
    );
    const mapping = await this.prisma.offlineRegistrationMapping.findUnique({
      where: { offlineQrToken: verified.payload.offlineQrToken },
    });

    if (
      !mapping ||
      !mapping.registrationId ||
      mapping.status === 'PENDING' ||
      mapping.status === 'CONFLICTED' ||
      mapping.status === 'REVOKED'
    ) {
      return {
        valid: false,
        pendingOffline: true,
        reason: 'OFFLINE_QR_PENDING_SYNC',
        verifiedOfflineQr: verified,
      };
    }

    const storedQrToken = await this.prisma.qrToken.findFirst({
      where: {
        id: mapping.canonicalQrTokenId ?? undefined,
        registrationId: mapping.registrationId,
      },
      include: {
        registration: {
          include: {
            attendeeType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
          },
        },
      },
    });

    if (!storedQrToken) {
      return {
        valid: false,
        reason: 'TOKEN_NOT_FOUND',
        payload: verified.payload as unknown as Record<string, unknown>,
        registrationId: mapping.registrationId,
      };
    }

    if (
      storedQrToken.eventId !== eventId ||
      verified.payload.eventId !== eventId ||
      verified.payload.attendeeTypeId !==
        storedQrToken.registration.attendeeTypeId
    ) {
      return {
        valid: false,
        reason: 'EVENT_MISMATCH',
        payload: verified.payload as unknown as Record<string, unknown>,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    if (storedQrToken.status === QrTokenStatus.REVOKED) {
      return {
        valid: false,
        reason: 'TOKEN_REVOKED',
        payload: verified.payload as unknown as Record<string, unknown>,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    const now = new Date();
    if (
      storedQrToken.status === QrTokenStatus.EXPIRED ||
      now < storedQrToken.validFrom ||
      now > storedQrToken.validUntil
    ) {
      return {
        valid: false,
        reason: 'TOKEN_EXPIRED',
        payload: verified.payload as unknown as Record<string, unknown>,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    if (storedQrToken.registration.status !== RegistrationStatus.ACTIVE) {
      return {
        valid: false,
        reason: 'REGISTRATION_INACTIVE',
        payload: verified.payload as unknown as Record<string, unknown>,
        qrTokenId: storedQrToken.id,
        registrationId: storedQrToken.registrationId,
      };
    }

    return {
      valid: true,
      qrToken: storedQrToken,
      registration: storedQrToken.registration,
      payload: {
        ...verified.payload,
        inputType: 'OFFLINE_SIGNED',
        canonicalTokenId: storedQrToken.tokenId,
      },
    };
  }

  private async createPendingOfflineScanFromOnlineScan(
    createScanDto: CreateScanDto,
    scannedAtDevice: Date,
    verified: VerifiedOfflineQr,
  ) {
    if (!createScanDto.checkpointId) {
      throw new BadRequestException('Offline scans require a checkpoint');
    }

    const existing = await this.prisma.offlineScanOperation.findUnique({
      where: { operationId: createScanDto.operationId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.offlineScanOperation.create({
      data: {
        operationId: createScanDto.operationId,
        eventId: createScanDto.eventId,
        scannerDeviceId: createScanDto.deviceId,
        staffSessionId: createScanDto.staffSessionId,
        checkpointId: createScanDto.checkpointId,
        offlineQrToken: verified.payload.offlineQrToken,
        offlineRegistrationOperationId:
          verified.payload.offlineRegistrationOperationId,
        issuerDeviceId: verified.payload.issuerDeviceId,
        issuerKeyVersion: verified.payload.issuerKeyVersion,
        scannedAtDevice,
        movementType: createScanDto.type,
        localResult:
          typeof createScanDto.payload?.localResult === 'string'
            ? createScanDto.payload.localResult
            : undefined,
        qrPayload: verified.payload as unknown as Prisma.InputJsonValue,
        qrPayloadHash: verified.payloadHash,
        status: OfflineScanOperationStatus.PENDING_LINK,
        syncedAt: new Date(),
      },
    });
  }

  private async processOfflineScanOperation(offlineScanOperationId: string) {
    const offlineScan = await this.prisma.offlineScanOperation.findUnique({
      where: { id: offlineScanOperationId },
    });

    if (!offlineScan) {
      throw new NotFoundException('Offline scan operation not found');
    }

    if (
      offlineScan.status === OfflineScanOperationStatus.PROCESSED &&
      offlineScan.movementId
    ) {
      return {
        status: OfflineScanOperationStatus.PROCESSED,
        duplicate: true,
        offlineScanOperation: offlineScan,
      };
    }

    const existingRawScan = await this.prisma.scanEventRaw.findUnique({
      where: { operationId: offlineScan.operationId },
      include: this.rawScanInclude,
    });

    if (existingRawScan?.movementLog) {
      const updated = await this.prisma.offlineScanOperation.update({
        where: { id: offlineScan.id },
        data: {
          status: OfflineScanOperationStatus.PROCESSED,
          scanEventRawId: existingRawScan.id,
          movementId: existingRawScan.movementLog.id,
          registrationId: existingRawScan.registrationId,
          syncedAt: new Date(),
        },
      });

      return {
        status: OfflineScanOperationStatus.PROCESSED,
        duplicate: true,
        offlineScanOperation: updated,
      };
    }

    const qrContext = await this.getCanonicalContextForOfflineScan(offlineScan);
    if (!qrContext) {
      return {
        status: OfflineScanOperationStatus.PENDING_LINK,
        offlineScanOperation: offlineScan,
      };
    }

    const event = await this.ensureEventCanBeModified(offlineScan.eventId);
    await this.ensureActiveDevice(
      offlineScan.scannerDeviceId,
      offlineScan.eventId,
    );
    const staffSession = await this.ensureActiveStaffSession(
      offlineScan.staffSessionId ?? undefined,
      offlineScan.eventId,
    );
    const checkpoint = await this.ensureActiveCheckpoint(
      offlineScan.checkpointId,
      offlineScan.eventId,
    );
    const accessReason = this.getCheckpointAccessDenial(
      checkpoint,
      qrContext.registration.attendeeType.code,
    );
    const reentryReason = await this.getReentryDenial(
      event,
      qrContext.registration.id,
      offlineScan.movementType,
    );
    const reason = accessReason ?? reentryReason ?? 'ALLOWED';
    const result =
      reason === 'ALLOWED' ? MovementResult.ALLOWED : MovementResult.DENIED;
    const scanDto: CreateScanDto = {
      operationId: offlineScan.operationId,
      eventId: offlineScan.eventId,
      deviceId: offlineScan.scannerDeviceId,
      staffSessionId: offlineScan.staffSessionId ?? undefined,
      checkpointId: offlineScan.checkpointId,
      qrToken: offlineScan.offlineQrToken,
      type: offlineScan.movementType,
      scannedAtDevice: offlineScan.scannedAtDevice.toISOString(),
      payload: {
        inputType: 'OFFLINE_SIGNED',
        localResult: offlineScan.localResult,
      },
    };
    const processed = existingRawScan
      ? await this.updateRawScanAndCreateMovement(
          existingRawScan,
          qrContext,
          result,
          reason,
        )
      : await this.createProcessedScanAndMovement(
          scanDto,
          offlineScan.scannedAtDevice,
          qrContext,
          result,
          reason,
        );
    const scanEvent =
      'updatedScanEvent' in processed
        ? processed.updatedScanEvent
        : processed.scanEvent;
    const movement = processed.movement;
    const updated = await this.prisma.offlineScanOperation.update({
      where: { id: offlineScan.id },
      data: {
        status: OfflineScanOperationStatus.PROCESSED,
        registrationId: qrContext.registration.id,
        movementId: movement.id,
        scanEventRawId: scanEvent.id,
        syncedAt: new Date(),
      },
    });

    await this.touchActivity(offlineScan.scannerDeviceId, staffSession?.id);

    return {
      status: OfflineScanOperationStatus.PROCESSED,
      allowed: result === MovementResult.ALLOWED,
      reason,
      offlineScanOperation: updated,
      scanEvent,
      movement,
    };
  }

  private async getCanonicalContextForOfflineScan(
    offlineScan: OfflineScanOperation,
  ): Promise<ValidQrContext | null> {
    const mapping = await this.prisma.offlineRegistrationMapping.findFirst({
      where: {
        eventId: offlineScan.eventId,
        OR: [
          { offlineQrToken: offlineScan.offlineQrToken },
          {
            offlineRegistrationOperationId:
              offlineScan.offlineRegistrationOperationId ?? undefined,
          },
        ],
        registrationId: { not: null },
      },
    });

    if (!mapping?.registrationId) {
      return null;
    }

    const qrToken = await this.prisma.qrToken.findFirst({
      where: {
        id: mapping.canonicalQrTokenId ?? undefined,
        registrationId: mapping.registrationId,
        status: QrTokenStatus.ACTIVE,
      },
      include: {
        registration: {
          include: {
            attendeeType: {
              select: { id: true, code: true, nameAr: true, nameEn: true },
            },
          },
        },
      },
    });

    if (!qrToken) {
      throw new BadRequestException('Canonical QR token not found');
    }

    return {
      qrToken,
      registration: qrToken.registration,
      payload: {
        ...(offlineScan.qrPayload as Record<string, unknown> | null),
        inputType: 'OFFLINE_SIGNED',
        canonicalTokenId: qrToken.tokenId,
      },
    };
  }

  private async createInvalidScan(
    createScanDto: CreateScanDto,
    scannedAtDevice: Date,
    reason: string,
    qrPayload?: Record<string, unknown> | null,
    qrTokenId?: string,
    registrationId?: string,
  ) {
    return this.prisma.scanEventRaw.create({
      data: {
        operationId: createScanDto.operationId,
        eventId: createScanDto.eventId,
        deviceId: createScanDto.deviceId,
        staffSessionId: createScanDto.staffSessionId,
        checkpointId: createScanDto.checkpointId,
        registrationId,
        qrTokenId,
        qrPayload: qrPayload
          ? (qrPayload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        qrRaw: createScanDto.qrToken,
        type: createScanDto.type,
        status: ScanEventStatus.INVALID_QR,
        result: MovementResult.DENIED,
        reason,
        scannedAtDevice,
        processedAt: new Date(),
        payload:
          createScanDto.payload === undefined
            ? Prisma.JsonNull
            : (createScanDto.payload as Prisma.InputJsonValue),
      },
      include: this.rawScanInclude,
    });
  }

  private async createProcessedScanAndMovement(
    createScanDto: CreateScanDto,
    scannedAtDevice: Date,
    qrContext: ValidQrContext,
    result: MovementResult,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const scanEvent = await tx.scanEventRaw.create({
        data: {
          operationId: createScanDto.operationId,
          eventId: createScanDto.eventId,
          deviceId: createScanDto.deviceId,
          staffSessionId: createScanDto.staffSessionId,
          checkpointId: createScanDto.checkpointId,
          registrationId: qrContext.registration.id,
          qrTokenId: qrContext.qrToken.id,
          qrPayload: qrContext.payload as Prisma.InputJsonValue,
          qrRaw: createScanDto.qrToken,
          type: createScanDto.type,
          status: ScanEventStatus.PROCESSED,
          result,
          reason,
          scannedAtDevice,
          processedAt: new Date(),
          payload:
            createScanDto.payload === undefined
              ? Prisma.JsonNull
              : (createScanDto.payload as Prisma.InputJsonValue),
        },
        include: this.rawScanInclude,
      });
      const movement = await tx.movementLog.create({
        data: {
          eventId: createScanDto.eventId,
          registrationId: qrContext.registration.id,
          qrTokenId: qrContext.qrToken.id,
          scanEventRawId: scanEvent.id,
          deviceId: createScanDto.deviceId,
          staffSessionId: createScanDto.staffSessionId,
          checkpointId: createScanDto.checkpointId,
          type: createScanDto.type,
          result,
          reason,
          occurredAt: scannedAtDevice,
        },
        include: this.movementInclude,
      });

      return { scanEvent, movement };
    });
  }

  private async updateInvalidRawScan(
    scanEventRawId: string,
    reason: string,
    qrPayload?: Record<string, unknown> | null,
    qrTokenId?: string,
    registrationId?: string,
  ) {
    return this.prisma.scanEventRaw.update({
      where: { id: scanEventRawId },
      data: {
        qrTokenId,
        registrationId,
        qrPayload: qrPayload
          ? (qrPayload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        status: ScanEventStatus.INVALID_QR,
        result: MovementResult.DENIED,
        reason,
        processedAt: new Date(),
      },
      include: this.rawScanInclude,
    });
  }

  private async updateRawScanAndCreateMovement(
    scanEvent: Prisma.ScanEventRawGetPayload<Record<string, never>>,
    qrContext: ValidQrContext,
    result: MovementResult,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updatedScanEvent = await tx.scanEventRaw.update({
        where: { id: scanEvent.id },
        data: {
          registrationId: qrContext.registration.id,
          qrTokenId: qrContext.qrToken.id,
          qrPayload: qrContext.payload as Prisma.InputJsonValue,
          status: ScanEventStatus.PROCESSED,
          result,
          reason,
          processedAt: new Date(),
        },
        include: this.rawScanInclude,
      });
      const movement = await tx.movementLog.create({
        data: {
          eventId: scanEvent.eventId,
          registrationId: qrContext.registration.id,
          qrTokenId: qrContext.qrToken.id,
          scanEventRawId: scanEvent.id,
          deviceId: scanEvent.deviceId,
          staffSessionId: scanEvent.staffSessionId,
          checkpointId: scanEvent.checkpointId,
          type: scanEvent.type,
          result,
          reason,
          occurredAt: scanEvent.scannedAtDevice,
        },
        include: this.movementInclude,
      });

      return { updatedScanEvent, movement };
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

  private async ensureActiveDevice(
    deviceId: string,
    eventId: string,
  ): Promise<Device> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.eventId !== eventId) {
      throw new BadRequestException('Device must belong to the same event');
    }

    if (device.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException('Device must be ACTIVE');
    }

    return device;
  }

  private async ensureActiveStaffSession(
    staffSessionId: string | undefined,
    eventId: string,
  ): Promise<StaffSession | null> {
    if (!staffSessionId) {
      return null;
    }

    const staffSession = await this.prisma.staffSession.findUnique({
      where: { id: staffSessionId },
    });

    if (!staffSession) {
      throw new NotFoundException('Staff session not found');
    }

    if (staffSession.eventId !== eventId) {
      throw new BadRequestException(
        'Staff session must belong to the same event',
      );
    }

    if (staffSession.status !== StaffSessionStatus.ACTIVE) {
      throw new BadRequestException('Staff session must be ACTIVE');
    }

    return staffSession;
  }

  private async ensureActiveCheckpoint(
    checkpointId: string | undefined,
    eventId: string,
  ): Promise<Checkpoint | null> {
    if (!checkpointId) {
      return null;
    }

    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: { id: checkpointId },
    });

    if (!checkpoint) {
      throw new NotFoundException('Checkpoint not found');
    }

    if (checkpoint.eventId !== eventId) {
      throw new BadRequestException('Checkpoint must belong to the same event');
    }

    if (!checkpoint.isActive) {
      throw new BadRequestException('Checkpoint must be active');
    }

    return checkpoint;
  }

  private getCheckpointAccessDenial(
    checkpoint: Checkpoint | null,
    attendeeTypeCode: string,
  ): string | null {
    if (!checkpoint || !Array.isArray(checkpoint.allowedAttendeeTypes)) {
      return null;
    }

    const allowedTypes = checkpoint.allowedAttendeeTypes.map(String);

    if (allowedTypes.length === 0 || allowedTypes.includes(attendeeTypeCode)) {
      return null;
    }

    return 'ATTENDEE_TYPE_NOT_ALLOWED';
  }

  private toScanDenialReason(reason: string) {
    const reasonMap: Record<string, string> = {
      INVALID_SIGNATURE: 'INVALID_QR',
      TOKEN_NOT_FOUND: 'INVALID_QR',
      EVENT_MISMATCH: 'WRONG_EVENT',
      TOKEN_REVOKED: 'QR_REVOKED',
      TOKEN_EXPIRED: 'QR_EXPIRED',
    };

    return reasonMap[reason] ?? reason;
  }

  private async formatScanResponse(input: {
    allowed: boolean;
    reason: string;
    scanEvent: any;
    movement: any | null;
    generateQrImage?: boolean;
  }) {
    const { scanEvent, movement } = input;
    const qr = await this.formatQrMetadata(
      scanEvent,
      input.generateQrImage === true,
    );
    const badge = await this.formatBadgeMetadata(scanEvent, qr);
    const registration = this.formatRegistration(scanEvent);

    return {
      allowed: input.allowed,
      reason: input.reason,
      scanEvent: {
        id: scanEvent.id,
        operationId: scanEvent.operationId,
        status: scanEvent.status,
        type: scanEvent.type,
        scannedAtDevice: scanEvent.scannedAtDevice,
      },
      movement: movement
        ? {
            id: movement.id,
            type: movement.type,
            result: movement.result,
            createdAt: movement.createdAt,
          }
        : null,
      registration,
      attendeeType:
        scanEvent.registration &&
        scanEvent.registration.eventId === scanEvent.eventId
          ? scanEvent.registration.attendeeType
          : null,
      event: scanEvent.event
        ? {
            id: scanEvent.event.id,
            titleAr: scanEvent.event.titleAr,
            titleEn: scanEvent.event.titleEn,
          }
        : null,
      checkpoint: scanEvent.checkpoint
        ? {
            id: scanEvent.checkpoint.id,
            nameAr: scanEvent.checkpoint.nameAr,
            nameEn: scanEvent.checkpoint.nameEn,
            type: scanEvent.checkpoint.type,
            code: scanEvent.checkpoint.code,
          }
        : null,
      device: scanEvent.device
        ? {
            id: scanEvent.device.id,
            name: scanEvent.device.name,
            code: scanEvent.device.code,
          }
        : null,
      staffSession: scanEvent.staffSession
        ? {
            id: scanEvent.staffSession.id,
            staffUserId: scanEvent.staffSession.staffUserId,
          }
        : null,
      qr,
      badge,
      registrationFields: await this.formatRegistrationFields(scanEvent),
    };
  }

  private formatRegistration(scanEvent: any) {
    const registration = scanEvent.registration;

    if (!registration || registration.eventId !== scanEvent.eventId) {
      return null;
    }

    const { attendeeType, ...registrationDetails } = registration;

    return registrationDetails;
  }

  private async formatRegistrationFields(scanEvent: any) {
    const registration = this.formatRegistration(scanEvent);

    if (!registration) {
      return [];
    }

    const fields = await this.prisma.registrationField.findMany({
      where: {
        eventId: registration.eventId,
        isActive: true,
        OR: [
          { attendeeTypeId: null },
          { attendeeTypeId: registration.attendeeTypeId },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        key: true,
        labelAr: true,
        labelEn: true,
        type: true,
        isRequired: true,
      },
    });

    return fields.map(({ isRequired, ...field }) => ({
      ...field,
      required: isRequired,
    }));
  }

  private async formatQrMetadata(scanEvent: any, generateQrImage: boolean) {
    if (
      !scanEvent.registration ||
      scanEvent.registration.eventId !== scanEvent.eventId ||
      !scanEvent.qrToken
    ) {
      return null;
    }

    try {
      const qr = await this.qrService.findByRegistration(
        scanEvent.registration.id,
      );
      const existingImage =
        await this.qrImageService.getRegistrationQrImageMetadata({
          registrationPublicId: scanEvent.registration.publicId,
        });
      const image =
        existingImage ??
        (generateQrImage
          ? await this.qrImageService.generateRegistrationQrImage({
              registrationPublicId: scanEvent.registration.publicId,
              qrToken: qr.qrToken,
            })
          : null);

      return {
        qrToken: qr.qrToken,
        imageUrl: image?.publicUrl ?? null,
        relativePath: image?.relativePath ?? null,
        status: qr.status,
        validFrom: qr.validFrom,
        validUntil: qr.validUntil,
      };
    } catch {
      return null;
    }
  }

  private async formatBadgeMetadata(
    scanEvent: any,
    qr: {
      qrToken: string;
      imageUrl: string | null;
      relativePath: string | null;
    } | null,
  ) {
    if (
      !scanEvent.registration ||
      scanEvent.registration.eventId !== scanEvent.eventId
    ) {
      return null;
    }

    try {
      return await this.badgeTemplatesService.resolveActiveBadgeForRegistration(
        {
          eventId: scanEvent.eventId,
          registration: scanEvent.registration,
          qr:
            qr && qr.imageUrl && qr.relativePath
              ? {
                  qrToken: qr.qrToken,
                  imageUrl: qr.imageUrl,
                  relativePath: qr.relativePath,
                }
              : null,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not attach badge data for scan ${scanEvent.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return null;
    }
  }

  private async getReentryDenial(
    event: Event,
    registrationId: string,
    type: MovementType,
  ): Promise<string | null> {
    if (event.allowReEntry || type !== MovementType.ENTRY) {
      return null;
    }

    const existingEntry = await this.prisma.movementLog.findFirst({
      where: {
        eventId: event.id,
        registrationId,
        type: MovementType.ENTRY,
        result: MovementResult.ALLOWED,
      },
    });

    return existingEntry ? 'ALREADY_ENTERED' : null;
  }

  private async touchActivity(deviceId: string, staffSessionId?: string) {
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: deviceId },
        data: { lastSeenAt: now },
      }),
      ...(staffSessionId
        ? [
            this.prisma.staffSession.update({
              where: { id: staffSessionId },
              data: { lastSeenAt: now },
            }),
          ]
        : []),
    ]);
  }

  private readonly rawScanInclude = {
    registration: {
      select: {
        id: true,
        publicId: true,
        eventId: true,
        attendeeTypeId: true,
        status: true,
        source: true,
        fullName: true,
        phone: true,
        email: true,
        companyName: true,
        jobTitle: true,
        externalId: true,
        customFields: true,
        notes: true,
        registeredAt: true,
        createdAt: true,
        updatedAt: true,
        attendeeType: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    },
    event: {
      select: { id: true, titleAr: true, titleEn: true },
    },
    checkpoint: {
      select: { id: true, nameAr: true, nameEn: true, type: true, code: true },
    },
    device: {
      select: { id: true, name: true, code: true },
    },
    staffSession: {
      select: { id: true, staffUserId: true },
    },
    qrToken: {
      select: {
        id: true,
        status: true,
        validFrom: true,
        validUntil: true,
      },
    },
    movementLog: true,
  } satisfies Prisma.ScanEventRawInclude;

  private readonly movementInclude = {
    registration: {
      select: { id: true, publicId: true, fullName: true, status: true },
    },
    event: {
      select: { id: true, titleAr: true, titleEn: true, status: true },
    },
    device: {
      select: { id: true, name: true, code: true, status: true },
    },
    checkpoint: {
      select: { id: true, nameAr: true, nameEn: true, code: true, type: true },
    },
  } satisfies Prisma.MovementLogInclude;
}
