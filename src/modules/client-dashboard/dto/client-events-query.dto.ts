import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EventStatus, EventType } from '@prisma/client';

export enum ClientEventSortBy {
  STARTS_AT = 'startsAt',
  ENDS_AT = 'endsAt',
  CREATED_AT = 'createdAt',
  TITLE_AR = 'titleAr',
  STATUS = 'status',
}

export enum ClientSortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export class ClientEventsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  /**
   * فلترة حسب تاريخ بداية الفعالية.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * المقصود دولة مكان الفعالية Venue.country.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsEnum(ClientEventSortBy)
  sortBy: ClientEventSortBy = ClientEventSortBy.STARTS_AT;

  @IsOptional()
  @IsEnum(ClientSortDirection)
  sortDirection: ClientSortDirection = ClientSortDirection.DESC;

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
