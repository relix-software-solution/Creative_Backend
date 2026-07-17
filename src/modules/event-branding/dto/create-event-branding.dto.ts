import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { EventBrandingThemeDto } from './event-branding-theme.dto';

export class CreateEventBrandingDto {
  @IsString()
  eventId: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string;

  @IsOptional()
  @IsString()
  certificateImageUrl?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EventBrandingThemeDto)
  theme?: EventBrandingThemeDto;
}
