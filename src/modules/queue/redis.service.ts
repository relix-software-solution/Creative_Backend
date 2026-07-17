import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CreateScanDto } from '../scans/dto/create-scan.dto';

export const REDIS_SCAN_INGEST_STREAM = 'scan:ingest';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async enqueueRawScan(createScanDto: CreateScanDto) {
    if (!this.configService.get<boolean>('REDIS_SCAN_INGEST_ENABLED', true)) {
      throw new ServiceUnavailableException('Redis scan ingest is disabled');
    }

    try {
      await this.ensureConnected();

      const operationKey = `scan:op:${createScanDto.operationId}`;
      const operationCreated = await this.client.set(
        operationKey,
        '1',
        'EX',
        86400,
        'NX',
      );

      if (!operationCreated) {
        return {
          accepted: true,
          duplicate: true,
          queued: true,
          transport: 'redis-stream',
        };
      }

      await this.client.xadd(
        REDIS_SCAN_INGEST_STREAM,
        '*',
        'operationId',
        createScanDto.operationId,
        'eventId',
        createScanDto.eventId,
        'deviceId',
        createScanDto.deviceId,
        'staffSessionId',
        createScanDto.staffSessionId ?? '',
        'checkpointId',
        createScanDto.checkpointId ?? '',
        'qrRaw',
        createScanDto.qrToken,
        'type',
        createScanDto.type,
        'scannedAtDevice',
        createScanDto.scannedAtDevice,
        'payload',
        createScanDto.payload ? JSON.stringify(createScanDto.payload) : '',
        'receivedAtServer',
        new Date().toISOString(),
      );

      return {
        accepted: true,
        queued: true,
        transport: 'redis-stream',
      };
    } catch {
      throw new ServiceUnavailableException('Redis scan ingest is unavailable');
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  private async ensureConnected() {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }
}
