import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
