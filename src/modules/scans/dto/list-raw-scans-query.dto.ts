import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MovementType, ScanEventStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListRawScansQueryDto extends PaginationQueryDto {
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
  @IsString()
  checkpointId?: string;

  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsEnum(ScanEventStatus)
  status?: ScanEventStatus;

  @IsOptional()
  @IsEnum(MovementType)
  type?: MovementType;
}
