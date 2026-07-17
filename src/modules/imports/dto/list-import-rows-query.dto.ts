import { IsEnum, IsOptional } from 'class-validator';
import { ImportRowStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListImportRowsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportRowStatus)
  status?: ImportRowStatus;
}
