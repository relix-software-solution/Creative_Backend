import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  NotificationChannel,
  NotificationProvider,
  NotificationStatus,
} from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListNotificationLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationProvider)
  provider?: NotificationProvider;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsString()
  recipient?: string;
}
