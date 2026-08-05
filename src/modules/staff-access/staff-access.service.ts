import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  DeviceStatus,
  EventStatus,
  MovementType,
  StaffScanMode,
  StaffSessionStatus,
  SyncOperationType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import type { CreateScanDto } from '../scans/dto/create-scan.dto';
import type {
  SubmitSyncBatchDto,
  SubmitSyncOperationDto,
} from '../sync/dto/submit-sync-batch.dto';

@Injectable()
export class StaffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * التحقق من أن موظف STAFF يستطيع تنفيذ عملية السكان المطلوبة.
   *
   * SUPER_ADMIN يبقى مسموحًا له باستخدام المسار الإداري
   * من دون إجباره على وجود StaffAssignment.
   */
  async assertStaffCanScan(
    currentUser: AuthUser,
    createScanDto: CreateScanDto,
  ) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return;
    }

    this.assertStaffRole(currentUser);

    const staffSessionId = this.requireString(
      createScanDto.staffSessionId,
      'staffSessionId',
    );

    const checkpointId = this.requireString(
      createScanDto.checkpointId,
      'checkpointId',
    );

    const context = await this.loadStaffContext({
      userId: currentUser.id,
      eventId: createScanDto.eventId,
      staffSessionId,
    });

    this.assertAssignmentAndSessionBinding({
      context,
      eventId: createScanDto.eventId,
      deviceId: createScanDto.deviceId,
      checkpointId,
      staffSessionId,
    });

    this.assertMovementMatchesSession(createScanDto.type, context.session.mode);
  }

  /**
   * التحقق من Batch المرسل عن طريق JWT.
   *
   * هذا يمنع موظف STAFF من:
   * - المزامنة مع فعالية أخرى.
   * - استخدام جهاز موظف آخر.
   * - استخدام Session لموظف آخر.
   * - إرسال عمليات مسح لنقطة مختلفة.
   * - إرسال نوع حركة مختلف عن وضع الجلسة.
   * - طلب QR لتسجيل يتبع فعالية أخرى.
   */
  async assertStaffCanSubmitSyncBatch(
    currentUser: AuthUser,
    submitSyncBatchDto: SubmitSyncBatchDto,
  ) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return;
    }

    this.assertStaffRole(currentUser);

    const staffSessionId = this.requireString(
      submitSyncBatchDto.staffSessionId,
      'staffSessionId',
    );

    const context = await this.loadStaffContext({
      userId: currentUser.id,
      eventId: submitSyncBatchDto.eventId,
      staffSessionId,
    });

    this.assertAssignmentAndSessionBinding({
      context,
      eventId: submitSyncBatchDto.eventId,
      deviceId: submitSyncBatchDto.deviceId,
      checkpointId: context.session.checkpointId,
      staffSessionId,
    });

    this.assertUniqueOperationIds(submitSyncBatchDto.operations);

    const registrationIds: string[] = [];

    for (const operation of submitSyncBatchDto.operations) {
      this.assertOperationScope({
        operation,
        eventId: submitSyncBatchDto.eventId,
        deviceId: submitSyncBatchDto.deviceId,
        staffSessionId,
        checkpointId: context.session.checkpointId,
        sessionMode: context.session.mode,
      });

      if (operation.type === SyncOperationType.QR_GENERATION) {
        const registrationId = this.getOptionalString(
          operation.payload,
          'registrationId',
        );

        if (registrationId) {
          registrationIds.push(registrationId);
        }
      }
    }

    await this.assertRegistrationsBelongToEvent(
      registrationIds,
      submitSyncBatchDto.eventId,
    );
  }

  private async loadStaffContext(input: {
    userId: string;
    eventId: string;
    staffSessionId: string;
  }) {
    const [assignment, session] = await this.prisma.$transaction([
      this.prisma.staffAssignment.findUnique({
        where: {
          eventId_userId: {
            eventId: input.eventId,
            userId: input.userId,
          },
        },
        include: {
          event: {
            select: {
              id: true,
              status: true,
              isActive: true,
            },
          },
          user: {
            select: {
              id: true,
              role: true,
              status: true,
              deletedAt: true,
            },
          },
          checkpoint: {
            select: {
              id: true,
              eventId: true,
              type: true,
              isActive: true,
            },
          },
          device: {
            select: {
              id: true,
              eventId: true,
              status: true,
            },
          },
        },
      }),

      this.prisma.staffSession.findUnique({
        where: {
          id: input.staffSessionId,
        },
      }),
    ]);

    if (!assignment || !assignment.isActive) {
      throw new ForbiddenException(
        'No active staff assignment exists for this event',
      );
    }

    if (
      assignment.user.role !== UserRole.STAFF ||
      assignment.user.status !== UserStatus.ACTIVE ||
      assignment.user.deletedAt
    ) {
      throw new ForbiddenException('Staff user is not active');
    }

    if (
      assignment.event.status === EventStatus.ARCHIVED ||
      !assignment.event.isActive
    ) {
      throw new ForbiddenException('Assigned event is not active');
    }

    if (!assignment.deviceId || !assignment.device) {
      throw new BadRequestException(
        'Active staff assignment must include a device',
      );
    }

    if (assignment.device.eventId !== assignment.eventId) {
      throw new ForbiddenException(
        'Assigned device does not belong to the event',
      );
    }

    if (assignment.device.status !== DeviceStatus.ACTIVE) {
      throw new ForbiddenException('Assigned device must be ACTIVE');
    }

    if (!assignment.checkpointId || !assignment.checkpoint) {
      throw new BadRequestException(
        'Active staff assignment must include a checkpoint',
      );
    }

    if (assignment.checkpoint.eventId !== assignment.eventId) {
      throw new ForbiddenException(
        'Assigned checkpoint does not belong to the event',
      );
    }

    if (!assignment.checkpoint.isActive) {
      throw new ForbiddenException('Assigned checkpoint must be active');
    }

    if (!session) {
      throw new ForbiddenException('Staff session was not found');
    }

    if (
      session.status !== StaffSessionStatus.ACTIVE ||
      session.endedAt !== null
    ) {
      throw new ForbiddenException('Staff session must be ACTIVE');
    }

    return {
      assignment,
      session,
    };
  }

  private assertAssignmentAndSessionBinding(input: {
    context: Awaited<ReturnType<StaffAccessService['loadStaffContext']>>;
    eventId: string;
    deviceId: string;
    checkpointId: string;
    staffSessionId: string;
  }) {
    const { assignment, session } = input.context;

    if (assignment.eventId !== input.eventId) {
      throw new ForbiddenException(
        'Staff assignment does not belong to this event',
      );
    }

    if (assignment.deviceId !== input.deviceId) {
      throw new ForbiddenException(
        'Device must match the active staff assignment',
      );
    }

    if (assignment.checkpointId !== input.checkpointId) {
      throw new ForbiddenException(
        'Checkpoint must match the active staff assignment',
      );
    }

    if (session.id !== input.staffSessionId) {
      throw new ForbiddenException('Invalid staff session');
    }

    if (session.staffUserId !== assignment.userId) {
      throw new ForbiddenException('Staff session belongs to a different user');
    }

    if (session.eventId !== input.eventId) {
      throw new ForbiddenException(
        'Staff session belongs to a different event',
      );
    }

    if (session.deviceId !== input.deviceId) {
      throw new ForbiddenException(
        'Staff session belongs to a different device',
      );
    }

    if (session.checkpointId !== input.checkpointId) {
      throw new ForbiddenException(
        'Staff session belongs to a different checkpoint',
      );
    }
  }

  private assertOperationScope(input: {
    operation: SubmitSyncOperationDto;
    eventId: string;
    deviceId: string;
    staffSessionId: string;
    checkpointId: string;
    sessionMode: StaffScanMode;
  }) {
    const payload = input.operation.payload;

    const payloadEventId = this.getOptionalString(payload, 'eventId');

    if (payloadEventId && payloadEventId !== input.eventId) {
      throw new ForbiddenException(
        `Operation ${input.operation.operationId} targets a different event`,
      );
    }

    const payloadDeviceId = this.getOptionalString(payload, 'deviceId');

    if (payloadDeviceId && payloadDeviceId !== input.deviceId) {
      throw new ForbiddenException(
        `Operation ${input.operation.operationId} targets a different device`,
      );
    }

    if (input.operation.type === SyncOperationType.SCAN_EVENT) {
      const checkpointId = this.requirePayloadString(
        payload,
        'checkpointId',
        input.operation.operationId,
      );

      if (checkpointId !== input.checkpointId) {
        throw new ForbiddenException(
          `Operation ${input.operation.operationId} targets a different checkpoint`,
        );
      }

      const movementType = this.requirePayloadString(
        payload,
        'type',
        input.operation.operationId,
      );

      this.assertMovementMatchesSession(
        movementType,
        input.sessionMode,
        input.operation.operationId,
      );

      return;
    }

    if (input.operation.type === SyncOperationType.OFFLINE_SCAN) {
      const checkpointId = this.requirePayloadString(
        payload,
        'checkpointId',
        input.operation.operationId,
      );

      if (checkpointId !== input.checkpointId) {
        throw new ForbiddenException(
          `Offline scan ${input.operation.operationId} targets a different checkpoint`,
        );
      }

      /*
       * staffSessionId الموجود داخل Payload يمثل الجلسة الأصلية وقت
       * المسح وقد تكون انتهت قبل رجوع الإنترنت. صلاحية المزامنة تُؤخذ
       * من Session الحالية الموجودة على مستوى Batch، مع استمرار التحقق
       * الصارم من الفعالية والجهاز ونقطة الدخول ونوع الحركة.
       */

      const movementType = this.requirePayloadString(
        payload,
        'movementType',
        input.operation.operationId,
      );

      this.assertMovementMatchesSession(
        movementType,
        input.sessionMode,
        input.operation.operationId,
      );
    }
  }

  private assertMovementMatchesSession(
    movementType: unknown,
    sessionMode: StaffScanMode,
    operationId?: string,
  ) {
    if (
      typeof movementType !== 'string' ||
      !Object.values(MovementType).includes(movementType as MovementType)
    ) {
      throw new BadRequestException(
        operationId
          ? `Operation ${operationId} has an invalid movement type`
          : 'Invalid movement type',
      );
    }

    /*
     * أسماء MovementType وStaffScanMode متطابقة:
     *
     * ENTRY
     * EXIT
     * CHECKPOINT
     * BOOTH_VISIT
     * SESSION_ATTENDANCE
     * VIP_ACCESS
     */
    if (movementType !== sessionMode) {
      throw new BadRequestException(
        operationId
          ? `Operation ${operationId} movement type must match the active staff session mode`
          : 'Scan movement type must match the active staff session mode',
      );
    }
  }

  private assertUniqueOperationIds(operations: SubmitSyncOperationDto[]) {
    const operationIds = new Set<string>();

    for (const operation of operations) {
      if (operationIds.has(operation.operationId)) {
        throw new BadRequestException(
          `Duplicate operationId inside batch: ${operation.operationId}`,
        );
      }

      operationIds.add(operation.operationId);
    }
  }

  private async assertRegistrationsBelongToEvent(
    registrationIds: string[],
    eventId: string,
  ) {
    const uniqueRegistrationIds = [...new Set(registrationIds)];

    if (uniqueRegistrationIds.length === 0) {
      return;
    }

    const registrations = await this.prisma.registration.findMany({
      where: {
        id: {
          in: uniqueRegistrationIds,
        },
      },
      select: {
        id: true,
        eventId: true,
      },
    });

    const registrationsById = new Map(
      registrations.map((registration) => [registration.id, registration]),
    );

    for (const registrationId of uniqueRegistrationIds) {
      const registration = registrationsById.get(registrationId);

      if (!registration) {
        throw new BadRequestException(
          `Registration not found: ${registrationId}`,
        );
      }

      if (registration.eventId !== eventId) {
        throw new ForbiddenException(
          `Registration ${registrationId} belongs to a different event`,
        );
      }
    }
  }

  private assertStaffRole(currentUser: AuthUser) {
    if (currentUser.role !== UserRole.STAFF) {
      throw new ForbiddenException(
        'Only STAFF or SUPER_ADMIN can perform this operation',
      );
    }
  }

  private requireString(value: unknown, field: string) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required for STAFF`);
    }

    return value.trim();
  }

  private requirePayloadString(
    payload: Record<string, unknown>,
    field: string,
    operationId: string,
  ) {
    const value = payload[field];

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        `${field} is required for operation ${operationId}`,
      );
    }

    return value.trim();
  }

  private getOptionalString(payload: Record<string, unknown>, field: string) {
    const value = payload[field];

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }
}
