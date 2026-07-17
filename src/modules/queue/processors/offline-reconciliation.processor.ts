import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ScansService } from '../../scans/scans.service';
import { QUEUE_NAMES } from '../queue.constants';

export type OfflineRegistrationReconcileJob = {
  eventId: string;
  offlineQrToken: string;
  offlineRegistrationOperationId: string;
  registrationId: string;
};

@Processor(QUEUE_NAMES.OFFLINE_RECONCILIATION)
export class OfflineReconciliationProcessor extends WorkerHost {
  constructor(private readonly scansService: ScansService) {
    super();
  }

  async process(job: Job<OfflineRegistrationReconcileJob>) {
    if (job.name !== 'offline.registration.reconcile') {
      return { skipped: true, reason: 'UNKNOWN_JOB' };
    }

    return this.scansService.reconcileOfflineRegistration(job.data);
  }
}
