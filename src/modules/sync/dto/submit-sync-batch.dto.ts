import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SyncOperationType } from '@prisma/client';

export class SubmitSyncOperationDto {
  @IsString()
  operationId: string;

  @IsEnum(SyncOperationType)
  type: SyncOperationType;

  @IsObject()
  payload: Record<string, unknown>;
}

export class SubmitSyncBatchDto {
  @IsString()
  batchId: string;

  @IsString()
  eventId: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  staffSessionId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitSyncOperationDto)
  operations: SubmitSyncOperationDto[];
}
