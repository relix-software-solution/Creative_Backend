import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CheckpointType } from '@prisma/client';

export class CreateCheckpointDto {
  @IsString()
  eventId: string;

  @IsOptional()
  @IsString()
  venueId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsEnum(CheckpointType)
  type: CheckpointType;

  @IsString()
  @MaxLength(200)
  nameAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @IsString()
  @MaxLength(100)
  code: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedAttendeeTypes?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number = 0;
}
