import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class StaffVisitorChangesQueryDto {
  /**
   * Last durable VisitorChange cursor applied by the scanner.
   * BigInt is transferred as a decimal string to avoid JavaScript precision
   * loss.
   */
  @IsOptional()
  @IsString()
  after?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return 500;
    }

    return Number(value);
  })
  @IsInt()
  @Min(1)
  @Max(1000)
  limit: number = 500;
}
