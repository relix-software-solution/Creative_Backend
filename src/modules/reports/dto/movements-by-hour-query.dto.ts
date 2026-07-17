import { IsDateString, IsOptional } from 'class-validator';

export class MovementsByHourQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
