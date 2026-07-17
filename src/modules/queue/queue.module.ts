import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { ImportsModule } from '../imports/imports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QrModule } from '../qr/qr.module';
import { ScansModule } from '../scans/scans.module';
import { AdminQueuesController } from './admin-queues.controller';
import { DigitalTicketGenerationProcessor } from './processors/digital-ticket-generation.processor';
import { ImportProcessingProcessor } from './processors/import-processing.processor';
import { OfflineReconciliationProcessor } from './processors/offline-reconciliation.processor';
import { RegistrationPipelineProcessor } from './processors/registration-pipeline.processor';
import { RedisScanFlusherService } from './processors/redis-scan-flusher.service';
import { ScanProcessingProcessor } from './processors/scan-processing.processor';
import { WhatsAppNotificationProcessor } from './processors/whatsapp-notification.processor';
import { QueueHealthService } from './queue-health.service';
import { QUEUE_NAMES } from './queue.constants';
import { RedisService } from './redis.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 0),
        },
        prefix: configService.get<string>('QUEUE_PREFIX', 'event_ops'),
      }),
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.REGISTRATION_PIPELINE,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.IMPORT_PROCESSING,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.SCAN_PROCESSING,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.WHATSAPP_NOTIFICATIONS,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.DIGITAL_TICKET_GENERATION,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.EVENT_STORAGE_CLEANUP,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.OFFLINE_RECONCILIATION,
    }),
    QrModule,
    DigitalTicketsModule,
    NotificationsModule,
    ImportsModule,
    ScansModule,
  ],
  providers: [
    QueueHealthService,
    RedisService,
    RegistrationPipelineProcessor,
    DigitalTicketGenerationProcessor,
    ImportProcessingProcessor,
    ScanProcessingProcessor,
    WhatsAppNotificationProcessor,
    RedisScanFlusherService,
    OfflineReconciliationProcessor,
  ],
  controllers: [AdminQueuesController],
  exports: [BullModule, QueueHealthService, RedisService],
})
export class QueueModule {}
