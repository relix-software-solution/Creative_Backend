import { PartialType } from '@nestjs/mapped-types';
import { CreateEventBrandingDto } from './create-event-branding.dto';

export class UpdateEventBrandingDto extends PartialType(
  CreateEventBrandingDto,
) {}
