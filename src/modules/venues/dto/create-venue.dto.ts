import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVenueDto {
  @IsString()
  eventId: string;

  @IsString()
  @MaxLength(200)
  nameAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @IsOptional()
  @IsString()
  addressAr?: string;

  @IsOptional()
  @IsString()
  addressEn?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;
}
