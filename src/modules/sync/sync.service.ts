import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  DeviceStatus,
  EventStatus,
  MovementType,
  OfflineRegistrationMappingStatus,
  Prisma,
  RegistrationSource,
  StaffSessionStatus,
  SyncBatchStatus,
  SyncOperation,
  SyncOperationStatus,
  SyncOperationType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { OfflineQrService } from '../offline/offline-qr.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { CreateRegistrationDto } from '../registrations/dto/create-registration.dto';
import { RegistrationsService } from '../registrations/registrations.service';
import { QrService } from '../qr/qr.service';
import { ScansService } from '../scans/scans.service';
import { CreateScanDto } from '../scans/dto/create-scan.dto';
import { ListSyncBatchesQueryDto } from './dto/list-sync-batches-query.dto';
import {
  SubmitSyncBatchDto,
  SubmitSyncOperationDto,
} from './dto/submit-sync-batch.dto';

type LocalRegistrationMap = Map<string, { id: string; publicId: string }>;

const NON_RETRYABLE_OFFLINE_OPERATION_CODES = new Set([
  'DUPLICATE_REGISTRATION',
  'INVALID_OFFLINE_REGISTRATION',
  'OFFLINE_REGISTRATION_RESOURCE_NOT_FOUND',
  'OFFLINE_REGISTRATION_CONFLICT',
]);

const RETRYABLE_OFFLINE_OPERATION_CODES = new Set([
  'OPERATION_FAILED',
  'OFFLINE_REGISTRATION_FAILED',
  'OFFLINE_REGISTRATION_RETRYABLE_FAILURE',
  'PREVIOUS_OPERATION_FAILED',
  'PREVIOUS_OPERATION_NOT_COMPLETED',
  'OFFLINE_OPERATION_RESULT_MISSING',
  'CANONICAL_REGISTRATION_ID_MISSING',
]);

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationsService: RegistrationsService,
    private readonly qrService: QrService,
    private readonly scansService: ScansService,
    private readonly offlineQrService: OfflineQrService,
    @InjectQueue(QUEUE_NAMES.OFFLINE_RECONCILIATION)
    private readonly offlineReconciliationQueue: Queue,
  ) {}

  async submitBatch(submitSyncBatchDto: SubmitSyncBatchDto) {
    const existingBatch = await this.prisma.syncBatch.findUnique({
      where: { batchId: submitSyncBatchDto.batchId },
      include: this.syncBatchInclude,
    });

    if (existingBatch) {
      return { duplicate: true, batch: existingBatch };
    }

    await this.ensureEventCanBeModified(submitSyncBatchDto.eventId);
    await this.ensureActiveDevice(
      submitSyncBatchDto.deviceId,
      submitSyncBatchDto.eventId,
    );
    await this.ensureActiveStaffSession(
      submitSyncBatchDto.staffSessionId,
      submitSyncBatchDto.eventId,
    );

    const duplicateOperationIds = await this.findDuplicateOperationIds(
      submitSyncBatchDto.operations.map((operation) => operation.operationId),
    );
    const operationsToCreate = submitSyncBatchDto.operations.filter(
      (operation) => !duplicateOperationIds.has(operation.operationId),
    );

    const batch = await this.prisma.syncBatch.create({
      data: {
        batchId: submitSyncBatchDto.batchId,
        eventId: submitSyncBatchDto.eventId,
        deviceId: submitSyncBatchDto.deviceId,
        staffSessionId: submitSyncBatchDto.staffSessionId,
        status: SyncBatchStatus.RECEIVED,
        totalOperations: submitSyncBatchDto.operations.length,
        duplicateCount: duplicateOperationIds.size,
        payload: submitSyncBatchDto as unknown as Prisma.InputJsonValue,
        operations: {
          create: operationsToCreate.map((operation) => ({
            operationId: operation.operationId,
            type: operation.type,
            input: operation.payload as Prisma.InputJsonValue,
          })),
        },
      },
      include: this.syncBatchInclude,
    });

    return {
      duplicate: false,
      batch: await this.processBatch(
        batch.id,
        submitSyncBatchDto,
        duplicateOperationIds,
      ),
    };
  }

  async findAll(query: ListSyncBatchesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.SyncBatchWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.staffSessionId ? { staffSessionId: query.staffSessionId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.syncBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedAt: 'desc' },
        include: this.syncBatchInclude,
      }),
      this.prisma.syncBatch.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const batch = await this.prisma.syncBatch.findUnique({
      where: { id },
      include: this.syncBatchInclude,
    });

    if (!batch) {
      throw new NotFoundException('Sync batch not found');
    }

    return batch;
  }

  private async processBatch(
    batchId: string,
    submitSyncBatchDto: SubmitSyncBatchDto,
    duplicateOperationIds: Set<string>,
  ) {
    await this.prisma.syncBatch.update({
      where: { id: batchId },
      data: { status: SyncBatchStatus.PROCESSING },
    });

    const operations = await this.prisma.syncOperation.findMany({
      where: { syncBatchId: batchId },
    });

    const operationsById = new Map(
      operations.map((operation) => [operation.operationId, operation]),
    );

    /**
     * العمليات الموجودة مسبقًا تعني أن الجهاز يعيد إرسال
     * نفس operationId.
     *
     * يجب أن نقرأ النتيجة الأصلية بدل إرجاع DUPLICATE فارغة،
     * لأن الفرونت يحتاج registrationId وcanonicalQrToken.
     */
    const existingDuplicateOperations =
      duplicateOperationIds.size > 0
        ? await this.prisma.syncOperation.findMany({
            where: {
              operationId: {
                in: [...duplicateOperationIds],
              },
            },
          })
        : [];

    const existingDuplicateOperationsById = new Map(
      existingDuplicateOperations.map((operation) => [
        operation.operationId,
        operation,
      ]),
    );

    const localRegistrations: LocalRegistrationMap = new Map();
    const operationResults: Array<Record<string, unknown>> = [];

    for (const operationDto of this.sortOperations(
      submitSyncBatchDto.operations,
    )) {
      if (duplicateOperationIds.has(operationDto.operationId)) {
        const existingOperation = existingDuplicateOperationsById.get(
          operationDto.operationId,
        );

        if (!existingOperation) {
          operationResults.push({
            operationId: operationDto.operationId,
            status: SyncOperationStatus.FAILED,
            errorCode: 'DUPLICATE_OPERATION_RESULT_NOT_FOUND',
            errorMessage:
              'The operation was previously received but its result could not be found',
          });

          continue;
        }

        /**
         * العملية نُفذت سابقًا بنجاح:
         * نعيد output الأصلي حتى يستطيع الفرونت الحصول
         * على registrationId والـQR الرسمي.
         */
        if (
          existingOperation.status === SyncOperationStatus.PROCESSED ||
          existingOperation.status === SyncOperationStatus.DUPLICATE
        ) {
          operationResults.push({
            operationId: operationDto.operationId,
            status: SyncOperationStatus.DUPLICATE,
            output: existingOperation.output,
          });

          continue;
        }

        /**
         * العملية السابقة فشلت.
         *
         * في النسخ القديمة كان أي فشل مؤقت يُحفظ نهائيًا، ثم كان
         * نفس operationId يُرفض إلى الأبد. عمليات التسجيل الأوفلاين
         * القابلة للاستعادة تُعاد معالجتها هنا بنفس operationId وبنفس
         * input الأصلي المحفوظ على السيرفر.
         */
        if (existingOperation.status === SyncOperationStatus.FAILED) {
          if (this.canRetryFailedOfflineOperation(existingOperation)) {
            const claimed = await this.prisma.syncOperation.updateMany({
              where: {
                id: existingOperation.id,
                status: SyncOperationStatus.FAILED,
              },
              data: {
                status: SyncOperationStatus.PENDING,
                errorCode: null,
                errorMessage: null,
                processedAt: null,
              },
            });

            if (claimed.count === 1) {
              const retryOperationDto: SubmitSyncOperationDto = {
                operationId: existingOperation.operationId,
                type: existingOperation.type,
                payload: this.toRecord(existingOperation.input),
              };

              const retryResult = await this.processOperation(
                existingOperation,
                retryOperationDto,
                submitSyncBatchDto,
                localRegistrations,
              );

              operationResults.push({
                ...retryResult,
                retried: true,
              });

              continue;
            }
          }

          operationResults.push({
            operationId: operationDto.operationId,
            status: SyncOperationStatus.FAILED,
            errorCode:
              existingOperation.errorCode ?? 'PREVIOUS_OPERATION_FAILED',
            errorMessage:
              existingOperation.errorMessage ??
              'The previous operation attempt failed',
            retryable: this.canRetryFailedOfflineOperation(existingOperation),
          });

          continue;
        }

        operationResults.push({
          operationId: operationDto.operationId,
          status: SyncOperationStatus.FAILED,
          errorCode: 'PREVIOUS_OPERATION_NOT_COMPLETED',
          errorMessage:
            'The previous operation has not completed processing yet',
        });

        continue;
      }

      const operation = operationsById.get(operationDto.operationId);

      if (!operation) {
        continue;
      }

      const result = await this.processOperation(
        operation,
        operationDto,
        submitSyncBatchDto,
        localRegistrations,
      );
      operationResults.push(result);
    }

    const processedCount = operationResults.filter(
      (result) => result.status === SyncOperationStatus.PROCESSED,
    ).length;
    const failedCount = operationResults.filter(
      (result) => result.status === SyncOperationStatus.FAILED,
    ).length;
    const duplicateCount = operationResults.filter(
      (result) => result.status === SyncOperationStatus.DUPLICATE,
    ).length;
    const status = this.getBatchStatus(
      processedCount,
      failedCount,
      duplicateCount,
    );
    const result = {
      processedCount,
      failedCount,
      duplicateCount,
      operations: operationResults,
    };

    return this.prisma.syncBatch.update({
      where: { id: batchId },
      data: {
        status,
        processedCount,
        failedCount,
        duplicateCount,
        processedAt: new Date(),
        result: result as Prisma.InputJsonValue,
      },
      include: this.syncBatchInclude,
    });
  }

  private async processOperation(
    operation: SyncOperation,
    operationDto: SubmitSyncOperationDto,
    batch: SubmitSyncBatchDto,
    localRegistrations: LocalRegistrationMap,
  ): Promise<Record<string, unknown>> {
    try {
      const output = await this.runOperation(
        operationDto,
        batch,
        localRegistrations,
      );

      /**
       * نجاح تنفيذ العملية يعني PROCESSED.
       *
       * لا نعتمد وجود خاصية باسم duplicate داخل output،
       * لأن DUPLICATE محجوز لإعادة نفس operationId فقط.
       */
      const status = SyncOperationStatus.PROCESSED;

      await this.prisma.syncOperation.update({
        where: { id: operation.id },
        data: {
          status,
          output: output as Prisma.InputJsonValue,
          errorCode: null,
          errorMessage: null,
          processedAt: new Date(),
        },
      });

      return {
        operationId: operation.operationId,
        status,
        output,
      };
    } catch (error) {
      const classified = this.classifySyncOperationError(error);

      await this.prisma.syncOperation.update({
        where: { id: operation.id },
        data: {
          status: SyncOperationStatus.FAILED,

          errorCode: classified.code,
          errorMessage: classified.message,

          processedAt: new Date(),
        },
      });

      return {
        operationId: operation.operationId,
        status: SyncOperationStatus.FAILED,

        errorCode: classified.code,
        errorMessage: classified.message,
        retryable: classified.retryable,
      };
    }
  }

  private classifySyncOperationError(error: unknown) {
    if (error instanceof ConflictException) {
      const response = error.getResponse();

      if (typeof response === 'string') {
        return {
          code: this.getConflictErrorCode(response),
          message: response,
          retryable: false,
        };
      }

      if (
        typeof response === 'object' &&
        response !== null &&
        !Array.isArray(response)
      ) {
        const record = response as Record<string, unknown>;

        const code =
          typeof record.code === 'string'
            ? record.code
            : typeof record.errorCode === 'string'
              ? record.errorCode
              : 'DUPLICATE_REGISTRATION';

        const rawMessage = record.message;

        const message = Array.isArray(rawMessage)
          ? rawMessage
              .filter((item): item is string => typeof item === 'string')
              .join(', ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : error.message;

        return {
          code,
          message,
          retryable: false,
        };
      }

      return {
        code: 'DUPLICATE_REGISTRATION',
        message: error.message || 'Duplicate registration for this event',
        retryable: false,
      };
    }

    if (error instanceof BadRequestException) {
      return {
        code: 'INVALID_OFFLINE_REGISTRATION',
        message: this.getHttpExceptionMessage(error),
        retryable: false,
      };
    }

    if (error instanceof NotFoundException) {
      return {
        code: 'OFFLINE_REGISTRATION_RESOURCE_NOT_FOUND',
        message: this.getHttpExceptionMessage(error),
        retryable: false,
      };
    }

    return {
      code: 'OPERATION_FAILED',
      message: error instanceof Error ? error.message : 'Operation failed',
      retryable: true,
    };
  }

  private getConflictErrorCode(message: string) {
    if (message === 'OFFLINE_REGISTRATION_CONFLICT') {
      return 'OFFLINE_REGISTRATION_CONFLICT';
    }

    if (
      message.includes('Duplicate registration') ||
      message.includes('unique')
    ) {
      return 'DUPLICATE_REGISTRATION';
    }

    return 'SYNC_OPERATION_CONFLICT';
  }

  private getHttpExceptionMessage(
    exception: BadRequestException | NotFoundException | ConflictException,
  ) {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      !Array.isArray(response)
    ) {
      const message = (response as Record<string, unknown>).message;

      if (Array.isArray(message)) {
        return message
          .filter((item): item is string => typeof item === 'string')
          .join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  private async runOperation(
    operationDto: SubmitSyncOperationDto,
    batch: SubmitSyncBatchDto,
    localRegistrations: LocalRegistrationMap,
  ) {
    if (operationDto.type === SyncOperationType.OFFLINE_REGISTRATION) {
      return this.runOfflineRegistration(
        operationDto,
        batch,
        localRegistrations,
      );
    }

    if (operationDto.type === SyncOperationType.OFFLINE_SCAN) {
      return this.runOfflineScan(operationDto, batch);
    }

    if (operationDto.type === SyncOperationType.QR_GENERATION) {
      const payload = operationDto.payload;
      const registrationId =
        this.getOptionalString(payload, 'registrationId') ??
        this.resolveLocalRegistrationId(payload, localRegistrations);

      return this.qrService.generate(registrationId);
    }

    const payload = operationDto.payload;

    return this.scansService.ingest({
      operationId: operationDto.operationId,
      eventId: batch.eventId,
      deviceId: batch.deviceId,
      staffSessionId: batch.staffSessionId,
      checkpointId: this.getOptionalString(payload, 'checkpointId'),
      qrToken: this.getString(payload, 'qrToken'),
      type: this.getString(payload, 'type') as CreateScanDto['type'],
      scannedAtDevice: this.getString(payload, 'scannedAtDevice'),
      payload: this.getOptionalRecord(payload, 'payload'),
    });
  }

  private async runOfflineRegistration(
    operationDto: SubmitSyncOperationDto,
    batch: SubmitSyncBatchDto,
    localRegistrations: LocalRegistrationMap,
  ) {
    const payload = operationDto.payload;
    const signedOfflineQr = this.getString(payload, 'signedOfflineQr');
    const verified = await this.offlineQrService.verifySignedOfflineQr(
      signedOfflineQr,
      batch.eventId,
    );

    if (verified.payload.issuerDeviceId !== batch.deviceId) {
      throw new BadRequestException(
        'Offline registration issuer must match authenticated device',
      );
    }

    const offlineRegistrationOperationId = this.getString(
      payload,
      'offlineRegistrationOperationId',
    );
    const offlineRegistrationId = this.getString(
      payload,
      'offlineRegistrationId',
    );
    const offlineQrToken = this.getString(payload, 'offlineQrToken');

    this.assertOfflineRegistrationPayloadMatchesQr(payload, verified.payload);

    const existingMapping = await this.findExistingOfflineMapping({
      eventId: batch.eventId,
      issuerDeviceId: batch.deviceId,
      offlineRegistrationOperationId,
      offlineRegistrationId,
      offlineQrToken,
    });

    if (existingMapping) {
      if (
        existingMapping.offlineQrToken !== offlineQrToken ||
        existingMapping.payloadHash !== verified.payloadHash
      ) {
        await this.prisma.offlineRegistrationMapping.update({
          where: { id: existingMapping.id },
          data: {
            status: OfflineRegistrationMappingStatus.CONFLICTED,
            conflictCode: 'OFFLINE_REGISTRATION_CONFLICT',
            conflictMessage:
              'Same offline registration identity was submitted with a different payload',
          },
        });
        throw new ConflictException('OFFLINE_REGISTRATION_CONFLICT');
      }

      if (existingMapping.registrationId) {
        const existingRegistration = await this.prisma.registration.findUnique({
          where: { id: existingMapping.registrationId },
        });

        if (existingRegistration) {
          localRegistrations.set(offlineRegistrationId, {
            id: existingRegistration.id,
            publicId: existingRegistration.publicId,
          });

          const canonicalQr = await this.qrService.generate(
            existingRegistration.id,
          );

          return {
            status: 'ALREADY_SYNCED',

            registrationId: existingRegistration.id,
            publicId: existingRegistration.publicId,

            registration: {
              id: existingRegistration.id,
              publicId: existingRegistration.publicId,

              eventId: existingRegistration.eventId,
              attendeeTypeId: existingRegistration.attendeeTypeId,

              status: existingRegistration.status,
              source: existingRegistration.source,

              fullName: existingRegistration.fullName,
              phone: existingRegistration.phone,
              email: existingRegistration.email,

              companyName: existingRegistration.companyName,
              jobTitle: existingRegistration.jobTitle,
              externalId: existingRegistration.externalId,

              customFields: existingRegistration.customFields ?? {},
              notes: existingRegistration.notes,

              registeredAt: existingRegistration.registeredAt,
              createdAt: existingRegistration.createdAt,
              updatedAt: existingRegistration.updatedAt,
            },

            offlineRegistrationOperationId,
            offlineRegistrationId,
            offlineQrToken,

            canonicalQrTokenId: existingMapping.canonicalQrTokenId ?? null,

            canonicalQrToken: canonicalQr.compactQrToken ?? canonicalQr.qrToken,

            canonicalSignedQrToken: canonicalQr.qrToken,
          };
        }
      }
    }

    const mapping = await this.prisma.offlineRegistrationMapping.upsert({
      where: {
        issuerDeviceId_eventId_offlineRegistrationOperationId: {
          issuerDeviceId: batch.deviceId,
          eventId: batch.eventId,
          offlineRegistrationOperationId,
        },
      },
      create: {
        eventId: batch.eventId,
        issuerDeviceId: batch.deviceId,
        offlineRegistrationOperationId,
        offlineRegistrationId,
        offlineQrToken,
        issuerKeyVersion: verified.payload.issuerKeyVersion,
        payloadHash: verified.payloadHash,
        status: OfflineRegistrationMappingStatus.PENDING,
      },
      update: {},
    });

    /**
     * استعادة عملية انقطعت بعد إنشاء Registration وقبل ربط Mapping.
     *
     * كل تسجيل أوفلاين يستخدم operationId كـexternalId، وهو فريد
     * داخل الفعالية. لذلك يمكننا استعادة التسجيل نفسه دون إنشاء
     * نسخة ثانية ودون الاعتماد على الهاتف أو البريد.
     */
    const operationExternalId =
      this.getOptionalString(payload, 'externalId') ??
      offlineRegistrationOperationId;

    const partiallyCreatedRegistration =
      await this.prisma.registration.findFirst({
        where: {
          eventId: batch.eventId,
          externalId: operationExternalId,
        },
      });

    if (partiallyCreatedRegistration) {
      const recoveredQr = await this.qrService.generate(
        partiallyCreatedRegistration.id,
      );

      const recoveredQrToken = await this.prisma.qrToken.findUnique({
        where: { tokenId: recoveredQr.payload.tokenId },
      });

      await this.prisma.offlineRegistrationMapping.update({
        where: { id: mapping.id },
        data: {
          registrationId: partiallyCreatedRegistration.id,
          canonicalQrTokenId: recoveredQrToken?.id,
          status: OfflineRegistrationMappingStatus.SYNCED,
          conflictCode: null,
          conflictMessage: null,
          syncedAt: new Date(),
        },
      });

      localRegistrations.set(offlineRegistrationId, {
        id: partiallyCreatedRegistration.id,
        publicId: partiallyCreatedRegistration.publicId,
      });

      await this.enqueueOfflineReconciliation({
        eventId: batch.eventId,
        offlineQrToken,
        offlineRegistrationOperationId,
        registrationId: partiallyCreatedRegistration.id,
      });

      return {
        status: 'RECOVERED_EXISTING',

        registrationId: partiallyCreatedRegistration.id,
        publicId: partiallyCreatedRegistration.publicId,

        registration: {
          id: partiallyCreatedRegistration.id,
          publicId: partiallyCreatedRegistration.publicId,
          eventId: partiallyCreatedRegistration.eventId,
          attendeeTypeId: partiallyCreatedRegistration.attendeeTypeId,

          fullName: partiallyCreatedRegistration.fullName,
          phone: partiallyCreatedRegistration.phone,
          email: partiallyCreatedRegistration.email,

          companyName: partiallyCreatedRegistration.companyName,
          jobTitle: partiallyCreatedRegistration.jobTitle,
          externalId: partiallyCreatedRegistration.externalId,

          customFields: partiallyCreatedRegistration.customFields ?? {},
          notes: partiallyCreatedRegistration.notes,

          status: partiallyCreatedRegistration.status,
          source: partiallyCreatedRegistration.source,

          registeredAt: partiallyCreatedRegistration.registeredAt,
          createdAt: partiallyCreatedRegistration.createdAt,
          updatedAt: partiallyCreatedRegistration.updatedAt,
        },

        offlineRegistrationOperationId,
        offlineRegistrationId,
        offlineQrToken,
        signedOfflineQr,

        canonicalQrTokenId: recoveredQrToken?.id ?? null,
        canonicalQrToken:
          recoveredQr.compactQrToken ?? recoveredQr.qrToken,
        canonicalSignedQrToken: recoveredQr.qrToken,
      };
    }

    let registration;
    try {
      registration = await this.registrationsService.create({
        eventId: batch.eventId,
        attendeeTypeId: this.getString(payload, 'attendeeTypeId'),
        fullName: this.getString(payload, 'fullName'),
        phone: this.getString(payload, 'phone'),
        email: this.getOptionalString(payload, 'email'),
        companyName: this.getOptionalString(payload, 'companyName'),
        jobTitle: this.getOptionalString(payload, 'jobTitle'),
        externalId: this.getOptionalString(payload, 'externalId'),
        customFields: this.getOptionalRecord(payload, 'customFields'),
        notes: this.getOptionalString(payload, 'notes'),
        source: RegistrationSource.OFFLINE_DEVICE,
      } satisfies CreateRegistrationDto);
    } catch (error) {
      const permanentFailure =
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException;

      await this.prisma.offlineRegistrationMapping.update({
        where: { id: mapping.id },

        data: {
          status: permanentFailure
            ? OfflineRegistrationMappingStatus.CONFLICTED
            : OfflineRegistrationMappingStatus.PENDING,

          conflictCode:
            error instanceof ConflictException
              ? 'DUPLICATE_REGISTRATION'
              : permanentFailure
                ? 'INVALID_OFFLINE_REGISTRATION'
                : 'OFFLINE_REGISTRATION_RETRYABLE_FAILURE',

          conflictMessage:
            error instanceof Error
              ? error.message
              : 'Offline registration failed',
        },
      });

      throw error;
    }

    const canonicalQr = await this.qrService.generate(registration.id);
    const canonicalQrToken = await this.prisma.qrToken.findUnique({
      where: { tokenId: canonicalQr.payload.tokenId },
    });

    await this.prisma.offlineRegistrationMapping.update({
      where: { id: mapping.id },
      data: {
        registrationId: registration.id,
        canonicalQrTokenId: canonicalQrToken?.id,
        status: OfflineRegistrationMappingStatus.SYNCED,
        syncedAt: new Date(),
      },
    });

    localRegistrations.set(offlineRegistrationId, {
      id: registration.id,
      publicId: registration.publicId,
    });

    await this.enqueueOfflineReconciliation({
      eventId: batch.eventId,
      offlineQrToken,
      offlineRegistrationOperationId,
      registrationId: registration.id,
    });

    return {
      status: 'CREATED',

      registrationId: registration.id,
      publicId: registration.publicId,

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

      offlineRegistrationOperationId,
      offlineRegistrationId,
      offlineQrToken,

      /*
       * هذا هو التوكن الذي طُبع أثناء Offline.
       * يجب أن يبقى صالحًا بعد المزامنة.
       */
      signedOfflineQr,

      canonicalQrTokenId: canonicalQrToken?.id ?? null,

      canonicalQrToken: canonicalQr.compactQrToken ?? canonicalQr.qrToken,

      canonicalSignedQrToken: canonicalQr.qrToken,
    };
  }

  private async runOfflineScan(
    operationDto: SubmitSyncOperationDto,
    batch: SubmitSyncBatchDto,
  ) {
    const payload = operationDto.payload;

    return this.scansService.ingestOfflineScan({
      operationId: operationDto.operationId,
      eventId: batch.eventId,
      scannerDeviceId: batch.deviceId,
      /*
       * نستخدم Session الحالية الموثقة على مستوى Batch.
       * Session المحفوظة داخل العملية تبقى للـaudit فقط وقد تكون منتهية.
       */
      staffSessionId: batch.staffSessionId,
      checkpointId: this.getString(payload, 'checkpointId'),
      signedOfflineQr: this.getString(payload, 'signedOfflineQr'),
      offlineQrToken: this.getOptionalString(payload, 'offlineQrToken'),
      offlineRegistrationOperationId: this.getOptionalString(
        payload,
        'offlineRegistrationOperationId',
      ),
      movementType: this.getString(payload, 'movementType') as MovementType,
      scannedAtDevice: this.getString(payload, 'scannedAtDevice'),
      localResult: this.getOptionalString(payload, 'localResult'),
    });
  }

  private sortOperations(operations: SubmitSyncOperationDto[]) {
    const order = [
      SyncOperationType.OFFLINE_REGISTRATION,
      SyncOperationType.OFFLINE_SCAN,
      SyncOperationType.QR_GENERATION,
      SyncOperationType.SCAN_EVENT,
    ];

    return operations
      .map((operation, index) => ({ operation, index }))
      .sort((left, right) => {
        const typeDiff =
          order.indexOf(left.operation.type) -
          order.indexOf(right.operation.type);

        return typeDiff === 0 ? left.index - right.index : typeDiff;
      })
      .map(({ operation }) => operation);
  }

  private async findExistingOfflineMapping(input: {
    eventId: string;
    issuerDeviceId: string;
    offlineRegistrationOperationId: string;
    offlineRegistrationId: string;
    offlineQrToken: string;
  }) {
    return this.prisma.offlineRegistrationMapping.findFirst({
      where: {
        eventId: input.eventId,
        OR: [
          {
            issuerDeviceId: input.issuerDeviceId,
            offlineRegistrationOperationId:
              input.offlineRegistrationOperationId,
          },
          {
            issuerDeviceId: input.issuerDeviceId,
            offlineRegistrationId: input.offlineRegistrationId,
          },
          { offlineQrToken: input.offlineQrToken },
        ],
      },
    });
  }

  private assertOfflineRegistrationPayloadMatchesQr(
    payload: Record<string, unknown>,
    qrPayload: {
      eventId: string;
      issuerDeviceId: string;
      offlineRegistrationOperationId: string;
      offlineRegistrationId?: string;
      offlineQrToken: string;
      attendeeTypeId: string;
    },
  ) {
    const comparisons: Array<[string, string | undefined]> = [
      ['eventId', qrPayload.eventId],
      [
        'offlineRegistrationOperationId',
        qrPayload.offlineRegistrationOperationId,
      ],
      ['offlineRegistrationId', qrPayload.offlineRegistrationId],
      ['offlineQrToken', qrPayload.offlineQrToken],
      ['attendeeTypeId', qrPayload.attendeeTypeId],
    ];

    for (const [field, expected] of comparisons) {
      if (expected && this.getString(payload, field) !== expected) {
        throw new BadRequestException(
          `Offline registration ${field} does not match signed QR`,
        );
      }
    }
  }

  private async enqueueOfflineReconciliation(input: {
    eventId: string;
    offlineQrToken: string;
    offlineRegistrationOperationId: string;
    registrationId: string;
  }) {
    try {
      await this.offlineReconciliationQueue.add(
        'offline.registration.reconcile',
        input,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        },
      );
    } catch {
      await this.scansService.reconcileOfflineRegistration(input);
    }
  }

  private getBatchStatus(
    processedCount: number,
    failedCount: number,
    duplicateCount: number,
  ) {
    if (failedCount > 0) {
      if (processedCount === 0 && duplicateCount === 0) {
        return SyncBatchStatus.FAILED;
      }

      return SyncBatchStatus.PARTIAL_FAILED;
    }

    if (processedCount === 0 && duplicateCount > 0) {
      return SyncBatchStatus.DUPLICATE;
    }

    return SyncBatchStatus.COMPLETED;
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

  private async ensureActiveDevice(deviceId: string, eventId: string) {
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
  }

  private async ensureActiveStaffSession(
    staffSessionId: string | undefined,
    eventId: string,
  ) {
    if (!staffSessionId) {
      return;
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
  }

  private canRetryFailedOfflineOperation(operation: SyncOperation) {
    if (operation.type !== SyncOperationType.OFFLINE_REGISTRATION) {
      return false;
    }

    const errorCode = operation.errorCode?.trim().toUpperCase();

    if (!errorCode) {
      return true;
    }

    if (NON_RETRYABLE_OFFLINE_OPERATION_CODES.has(errorCode)) {
      return false;
    }

    return (
      RETRYABLE_OFFLINE_OPERATION_CODES.has(errorCode) ||
      errorCode.startsWith('HTTP_5') ||
      errorCode.startsWith('NETWORK_') ||
      errorCode.startsWith('UNKNOWN_')
    );
  }

  private toRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    throw new BadRequestException('Stored sync operation input is invalid');
  }

  async recoverFailedOfflineRegistrations(input?: {
    eventId?: string;
    deviceId?: string;
    limit?: number;
    dryRun?: boolean;
  }) {
    const limit = Math.min(1000, Math.max(1, input?.limit ?? 250));

    const failedOperations = await this.prisma.syncOperation.findMany({
      where: {
        type: SyncOperationType.OFFLINE_REGISTRATION,
        status: SyncOperationStatus.FAILED,
        ...(input?.eventId || input?.deviceId
          ? {
              syncBatch: {
                ...(input.eventId ? { eventId: input.eventId } : {}),
                ...(input.deviceId ? { deviceId: input.deviceId } : {}),
              },
            }
          : {}),
      },
      include: {
        syncBatch: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const recoverable = failedOperations.filter((operation) =>
      this.canRetryFailedOfflineOperation(operation),
    );

    if (input?.dryRun) {
      return {
        dryRun: true,
        scanned: failedOperations.length,
        recoverable: recoverable.length,
        skippedPermanent: failedOperations.length - recoverable.length,
        operations: recoverable.map((operation) => ({
          operationId: operation.operationId,
          eventId: operation.syncBatch.eventId,
          deviceId: operation.syncBatch.deviceId,
          errorCode: operation.errorCode,
          errorMessage: operation.errorMessage,
        })),
      };
    }

    const results: Array<Record<string, unknown>> = [];

    for (const operation of recoverable) {
      const claimed = await this.prisma.syncOperation.updateMany({
        where: {
          id: operation.id,
          status: SyncOperationStatus.FAILED,
        },
        data: {
          status: SyncOperationStatus.PENDING,
          errorCode: null,
          errorMessage: null,
          processedAt: null,
        },
      });

      if (claimed.count !== 1) {
        results.push({
          operationId: operation.operationId,
          status: 'SKIPPED',
          reason: 'OPERATION_ALREADY_CLAIMED',
        });
        continue;
      }

      const operationDto: SubmitSyncOperationDto = {
        operationId: operation.operationId,
        type: operation.type,
        payload: this.toRecord(operation.input),
      };

      const batchDto: SubmitSyncBatchDto = {
        batchId: operation.syncBatch.batchId,
        eventId: operation.syncBatch.eventId,
        deviceId: operation.syncBatch.deviceId,
        staffSessionId: operation.syncBatch.staffSessionId ?? undefined,
        operations: [operationDto],
      };

      const result = await this.processOperation(
        operation,
        operationDto,
        batchDto,
        new Map(),
      );

      results.push(result);
    }

    return {
      dryRun: false,
      scanned: failedOperations.length,
      attempted: recoverable.length,
      processed: results.filter(
        (result) => result.status === SyncOperationStatus.PROCESSED,
      ).length,
      failed: results.filter(
        (result) => result.status === SyncOperationStatus.FAILED,
      ).length,
      skippedPermanent: failedOperations.length - recoverable.length,
      results,
    };
  }

  private async findDuplicateOperationIds(operationIds: string[]) {
    const existingOperations = await this.prisma.syncOperation.findMany({
      where: { operationId: { in: operationIds } },
      select: { operationId: true },
    });

    return new Set(
      existingOperations.map((operation) => operation.operationId),
    );
  }

  private resolveLocalRegistrationId(
    payload: Record<string, unknown>,
    localRegistrations: LocalRegistrationMap,
  ) {
    const localRegistrationId = this.getString(payload, 'localRegistrationId');
    const registration = localRegistrations.get(localRegistrationId);

    if (!registration) {
      throw new BadRequestException(
        'Local registration was not found in batch',
      );
    }

    return registration.id;
  }

  private getString(payload: Record<string, unknown>, key: string) {
    const value = payload[key];

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${key} is required`);
    }

    return value;
  }

  private getOptionalString(payload: Record<string, unknown>, key: string) {
    const value = payload[key];

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  private getOptionalRecord(payload: Record<string, unknown>, key: string) {
    const value = payload[key];

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return undefined;
  }

  private readonly syncBatchInclude = {
    operations: {
      orderBy: { createdAt: 'asc' },
    },
  } satisfies Prisma.SyncBatchInclude;
}
