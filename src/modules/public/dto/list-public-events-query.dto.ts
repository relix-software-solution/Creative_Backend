import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EventStatus, EventType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListPublicEventsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @IsOptional()
  @IsString()
  search?: string;
}
