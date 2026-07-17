import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  eventId: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(100)
  code: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
