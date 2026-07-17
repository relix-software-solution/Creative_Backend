import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { RegistrationFieldType } from '@prisma/client';

export class CreateRegistrationFieldDto {
  @IsString()
  eventId: string;

  @IsOptional()
  @IsString()
  attendeeTypeId?: string;

  @IsString()
  @MaxLength(100)
  key: string;

  @IsString()
  @MaxLength(200)
  labelAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  labelEn?: string;

  @IsEnum(RegistrationFieldType)
  type: RegistrationFieldType;

  @IsOptional()
  @IsString()
  placeholderAr?: string;

  @IsOptional()
  @IsString()
  placeholderEn?: string;

  @IsOptional()
  @IsString()
  helpTextAr?: string;

  @IsOptional()
  @IsString()
  helpTextEn?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRequired?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isUnique?: boolean = false;

  @IsOptional()
  options?: unknown;

  @IsOptional()
  validation?: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number = 0;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;
}
