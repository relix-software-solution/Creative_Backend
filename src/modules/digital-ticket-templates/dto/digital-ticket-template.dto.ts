export type DigitalTicketTemplateFieldDto = {
  key: string;
  source?: string;
  label?: string;
  visible?: boolean;
};

export type UpsertDigitalTicketTemplateDto = {
  eventId?: string;
  attendeeTypeId?: string | null;
  name?: string;
  widthPx?: number;
  heightPx?: number;
  backgroundImageUrl?: string;
  backgroundImagePath?: string;
  theme?: Record<string, unknown>;
  elements?: unknown[];
  selectedFields?: DigitalTicketTemplateFieldDto[];
};
