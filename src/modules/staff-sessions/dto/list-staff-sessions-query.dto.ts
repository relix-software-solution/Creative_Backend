import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StaffSessionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListStaffSessionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  staffUserId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  checkpointId?: string;

  @IsOptional()
  @IsEnum(StaffSessionStatus)
  status?: StaffSessionStatus;
}
