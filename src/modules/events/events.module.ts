import { Module } from '@nestjs/common';
import { StorageCleanupModule } from '../storage-cleanup/storage-cleanup.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [StorageCleanupModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
