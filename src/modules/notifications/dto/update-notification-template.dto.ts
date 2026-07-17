import { PartialType } from '@nestjs/mapped-types';
import { CreateNotificationTemplateDto } from './create-notification-template.dto';

export class UpdateNotificationTemplateDto extends PartialType(
  CreateNotificationTemplateDto,
) {}
