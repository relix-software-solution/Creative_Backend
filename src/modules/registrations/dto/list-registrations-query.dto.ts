import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RegistrationSource, RegistrationStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListRegistrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  attendeeTypeId?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @IsEnum(RegistrationSource)
  source?: RegistrationSource;

  @IsOptional()
  @IsString()
  search?: string;
}
