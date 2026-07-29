import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RegistrationSource, RegistrationStatus } from '@prisma/client';
import { ClientRegistrationAttendanceFilter } from './client-registrations-query.dto';

export enum ClientAnalyticsGranularity {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const source = Array.isArray(value) ? value : [value];

  const values = source
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

export class ClientAnalyticsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  eventId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  eventIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(191)
  attendeeTypeId?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @IsEnum(RegistrationSource)
  source?: RegistrationSource;

  @IsOptional()
  @IsEnum(ClientRegistrationAttendanceFilter)
  attendance?: ClientRegistrationAttendanceFilter;

  /**
   * عند عدم إرسال from وto:
   * سيتم استخدام آخر 30 يومًا.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * دولة مكان الفعالية.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  eventCountry?: string;

  @IsOptional()
  @IsEnum(ClientAnalyticsGranularity)
  granularity: ClientAnalyticsGranularity = ClientAnalyticsGranularity.DAY;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  topLimit = 10;
}
