import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MovementResult, MovementType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListMovementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  registrationId?: string;

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
  @IsEnum(MovementType)
  type?: MovementType;

  @IsOptional()
  @IsEnum(MovementResult)
  result?: MovementResult;
}
