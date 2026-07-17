import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListBadgeTemplatesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;
}
