import { Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { StaffScanMode } from '@prisma/client';

export class StartStaffSessionDto {
  @IsString()
  eventId: string;

  @IsString()
  deviceId: string;

  @IsString()
  checkpointId: string;

  @IsEnum(StaffScanMode)
  mode: StaffScanMode;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  staffUserId?: string;
}
