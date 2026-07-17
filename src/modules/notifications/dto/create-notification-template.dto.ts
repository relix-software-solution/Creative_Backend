import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import {
  Locale,
  NotificationChannel,
  NotificationTemplateType,
} from '@prisma/client';

export class CreateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsEnum(NotificationTemplateType)
  type: NotificationTemplateType;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale = Locale.AR;

  @IsString()
  name: string;

  @IsString()
  content: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;
}
