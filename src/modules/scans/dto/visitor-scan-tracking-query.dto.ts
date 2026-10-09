import { IsEnum, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { MovementResult, MovementType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const VISITOR_PRESENCE_STATES = [
  'INSIDE',
  'OUTSIDE',
  'NO_ALLOWED_MOVEMENT',
] as const;

export type VisitorPresenceState = (typeof VISITOR_PRESENCE_STATES)[number];

export class VisitorScanTrackingQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  attendeeTypeId?: string;

  @IsOptional()
  @IsEnum(MovementType)
  type?: MovementType;

  @IsOptional()
  @IsEnum(MovementResult)
  result?: MovementResult;

  @IsOptional()
  @IsIn(VISITOR_PRESENCE_STATES)
  state?: VisitorPresenceState;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
