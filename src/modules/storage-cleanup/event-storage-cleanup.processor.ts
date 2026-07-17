import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';
import {
  StorageCleanupJobData,
  StorageCleanupService,
} from './storage-cleanup.service';

@Processor(QUEUE_NAMES.EVENT_STORAGE_CLEANUP)
export class EventStorageCleanupProcessor extends WorkerHost {
  constructor(private readonly storageCleanupService: StorageCleanupService) {
    super();
  }

  async process(job: Job<StorageCleanupJobData>) {
    await job.updateProgress(10);

    const result = await this.storageCleanupService.runCleanupJob(job.data);

    await job.updateProgress(100);

    return result;
  }
}
