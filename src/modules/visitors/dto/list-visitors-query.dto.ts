import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RegistrationStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListVisitorsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @IsString()
  attendeeTypeId?: string;
}

export class ListAdminVisitorsQueryDto extends ListVisitorsQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;
}
