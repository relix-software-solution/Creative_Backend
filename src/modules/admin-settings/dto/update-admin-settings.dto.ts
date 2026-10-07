import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAdminSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  defaultLocale?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(100000)
  reportExportMaxRows?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  reportDefaultRangeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  notificationSummaryHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  notificationAlertThreshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(3600)
  notificationPollingSeconds?: number;
}
