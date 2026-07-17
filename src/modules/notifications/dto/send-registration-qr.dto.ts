import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Locale } from '@prisma/client';

export class SendRegistrationQrDto {
  @IsString()
  registrationId: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale = Locale.AR;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  forceResend?: boolean = false;
}
