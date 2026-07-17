import { IsDateString, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { MovementType } from '@prisma/client';

export class CreateScanDto {
  @IsString()
  operationId: string;

  @IsString()
  eventId: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  staffSessionId?: string;

  @IsOptional()
  @IsString()
  checkpointId?: string;

  @IsString()
  qrToken: string;

  @IsEnum(MovementType)
  type: MovementType;

  @IsDateString()
  scannedAtDevice: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
