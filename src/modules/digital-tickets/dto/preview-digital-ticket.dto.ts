import { IsOptional, IsString } from 'class-validator';
import { UpsertDigitalTicketTemplateDto } from '../../digital-ticket-templates/dto/digital-ticket-template.dto';

export class PreviewDigitalTicketDto implements UpsertDigitalTicketTemplateDto {
  @IsOptional()
  @IsString()
  registrationId?: string;

  eventId?: string;
  attendeeTypeId?: string | null;
  name?: string;
  widthPx?: number;
  heightPx?: number;
  backgroundImageUrl?: string;
  backgroundImagePath?: string;
  theme?: Record<string, unknown>;
  elements?: unknown[];
  selectedFields?: { key: string; source?: string; label?: string; visible?: boolean }[];
}
