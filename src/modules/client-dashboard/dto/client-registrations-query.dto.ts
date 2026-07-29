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

export enum ClientRegistrationAttendanceFilter {
  ATTENDED = 'ATTENDED',
  NOT_ATTENDED = 'NOT_ATTENDED',
}

export enum ClientRegistrationSortBy {
  REGISTERED_AT = 'registeredAt',
  FULL_NAME = 'fullName',
  STATUS = 'status',
  EVENT_TITLE = 'eventTitle',
}

export enum ClientRegistrationSortDirection {
  ASC = 'asc',
  DESC = 'desc',
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

export class ClientRegistrationsQueryDto {
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

  /**
   * يقبل:
   * eventIds=id1,id2
   * أو array من Axios.
   */
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
   * التاريخ هنا يعتمد على registeredAt.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * دولة مكان الفعالية، وليس دولة الزائر.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  eventCountry?: string;

  @IsOptional()
  @IsEnum(ClientRegistrationSortBy)
  sortBy: ClientRegistrationSortBy = ClientRegistrationSortBy.REGISTERED_AT;

  @IsOptional()
  @IsEnum(ClientRegistrationSortDirection)
  sortDirection: ClientRegistrationSortDirection =
    ClientRegistrationSortDirection.DESC;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
