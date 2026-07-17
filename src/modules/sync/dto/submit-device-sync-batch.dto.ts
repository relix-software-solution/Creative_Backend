import { OmitType } from '@nestjs/mapped-types';
import { SubmitSyncBatchDto } from './submit-sync-batch.dto';

export class SubmitDeviceSyncBatchDto extends OmitType(SubmitSyncBatchDto, [
  'deviceId',
] as const) {}
