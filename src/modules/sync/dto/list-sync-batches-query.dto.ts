import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SyncBatchStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListSyncBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  staffSessionId?: string;

  @IsOptional()
  @IsEnum(SyncBatchStatus)
  status?: SyncBatchStatus;
}
