import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ImportJobStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListImportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsEnum(ImportJobStatus)
  status?: ImportJobStatus;
}
