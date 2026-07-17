import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { EventType } from '@prisma/client';

export class CreateEventDto {
  @IsString()
  clientId: string;

  @IsEnum(EventType)
  type: EventType;

  @IsString()
  titleAr: string;

  @IsOptional()
  @IsString()
  titleEn?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'Asia/Damascus';

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowReEntry?: boolean = true;

  @IsOptional()
  @IsString()
  duplicateStrategy?: string = 'PHONE';

  @IsOptional()
  @IsDateString()
  qrValidFrom?: string;

  @IsOptional()
  @IsDateString()
  qrValidUntil?: string;
}
