import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_NAME_LIST } from './queue.constants';

@Injectable()
export class QueueHealthService {
  constructor(private readonly configService: ConfigService) {}

  async getHealth() {
    const redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await redis.connect();
      await redis.ping();

      return {
        redis: 'ok',
        queues: QUEUE_NAME_LIST,
      };
    } catch {
      return {
        redis: 'error',
        queues: QUEUE_NAME_LIST,
      };
    } finally {
      redis.disconnect();
    }
  }
}
