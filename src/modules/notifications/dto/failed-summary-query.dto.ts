import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class FailedSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sinceMinutes?: number;
}
