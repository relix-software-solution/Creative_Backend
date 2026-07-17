import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MovementType, Prisma, ScanEventStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { REDIS_SCAN_INGEST_STREAM, RedisService } from '../redis.service';

type RedisStreamEntry = [string, string[]];

@Injectable()
export class RedisScanFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisScanFlusherService.name);
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private lastId = '0-0';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    if (!this.configService.get<boolean>('REDIS_SCAN_FLUSH_ENABLED', true)) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flushOnce();
    }, 1000);
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  private async flushOnce() {
    if (this.flushing) {
      return;
    }

    this.flushing = true;

    try {
      const batchSize = this.configService.get<number>(
        'REDIS_SCAN_FLUSH_BATCH_SIZE',
        500,
      );
      const streams = await this.redisService.client.xread(
        'COUNT',
        batchSize,
        'BLOCK',
        100,
        'STREAMS',
        REDIS_SCAN_INGEST_STREAM,
        this.lastId,
      );

      if (!streams?.length) {
        return;
      }

      const entries = streams[0][1] as RedisStreamEntry[];
      const data = entries.map((entry) => this.toScanEventRawCreateMany(entry));

      if (data.length > 0) {
        await this.prisma.scanEventRaw.createMany({
          data,
          skipDuplicates: true,
        });
      }

      this.lastId = entries[entries.length - 1][0];
    } catch (error) {
      this.logger.error(
        'Failed to flush Redis scan stream',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.flushing = false;
    }
  }

  private toScanEventRawCreateMany([, fields]: RedisStreamEntry) {
    const item = this.fieldsToRecord(fields);
    const payload = item.payload ? JSON.parse(item.payload) : undefined;

    return {
      operationId: item.operationId,
      eventId: item.eventId,
      deviceId: item.deviceId,
      staffSessionId: item.staffSessionId || null,
      checkpointId: item.checkpointId || null,
      qrRaw: item.qrRaw,
      type: item.type as MovementType,
      status: ScanEventStatus.PENDING,
      scannedAtDevice: new Date(item.scannedAtDevice),
      receivedAtServer: new Date(item.receivedAtServer),
      payload:
        payload === undefined
          ? Prisma.JsonNull
          : (payload as Prisma.InputJsonValue),
    };
  }

  private fieldsToRecord(fields: string[]) {
    const record: Record<string, string> = {};

    for (let index = 0; index < fields.length; index += 2) {
      record[fields[index]] = fields[index + 1];
    }

    return record;
  }
}
