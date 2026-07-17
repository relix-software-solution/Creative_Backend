import { Controller, Get } from '@nestjs/common';
import { QueueHealthService } from '../queue/queue-health.service';

interface HealthResponse {
  status: 'ok';
  service: 'event-ops-backend';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly queueHealthService: QueueHealthService) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'event-ops-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('queues')
  getQueueHealth() {
    return this.queueHealthService.getHealth();
  }
}
