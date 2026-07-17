import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { EventStorageCleanupProcessor } from './event-storage-cleanup.processor';
import { StorageCleanupController } from './storage-cleanup.controller';
import { StorageCleanupService } from './storage-cleanup.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NAMES.EVENT_STORAGE_CLEANUP,
    }),
  ],
  controllers: [StorageCleanupController],
  providers: [StorageCleanupService, EventStorageCleanupProcessor],
  exports: [StorageCleanupService],
})
export class StorageCleanupModule {}
