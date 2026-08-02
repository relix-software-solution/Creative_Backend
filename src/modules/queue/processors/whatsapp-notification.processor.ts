import 'dotenv/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  getConfiguredWhatsAppRatePerSecond,
  getWhatsAppLimiterConfig,
} from '../../notifications/whatsapp-rate-limit.util';
import { QUEUE_NAMES } from '../queue.constants';

type WhatsAppNotificationJob = {
  notificationLogId: string;
  manualRetry?: boolean;
};

@Processor(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS, {
  concurrency: 1,
  limiter: getWhatsAppLimiterConfig(getConfiguredWhatsAppRatePerSecond()),
})
export class WhatsAppNotificationProcessor extends WorkerHost {
  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }
  async process(job: Job<WhatsAppNotificationJob>) {
    const configuredMaxAttempts = this.configService.get<number>(
      'WHATSAPP_SEND_MAX_ATTEMPTS',
      3,
    );

    const maxAttempts = Number(job.opts.attempts ?? configuredMaxAttempts);

    const attemptNumber = job.attemptsMade + 1;

    return this.notificationsService.deliverQueuedWhatsApp({
      notificationLogId: job.data.notificationLogId,
      attemptNumber,
      isFinalAttempt: attemptNumber >= maxAttempts,
      manualRetry: job.data.manualRetry === true,
    });
  }
}
