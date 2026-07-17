import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { QUEUE_NAMES } from './queue.constants';

@Controller('admin/queues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminQueuesController {
  constructor(
    @InjectQueue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS)
    private readonly whatsappNotificationsQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  @Get('whatsapp')
  async getWhatsAppQueue() {
    const counts = await this.whatsappNotificationsQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
    );
    const paused = await this.whatsappNotificationsQueue.isPaused();

    return {
      queue: QUEUE_NAMES.WHATSAPP_NOTIFICATIONS,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      completedRetained: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      paused,
      ratePerSecond: this.configService.get<number>(
        'WHATSAPP_SEND_RATE_PER_SECOND',
        3,
      ),
    };
  }
}
