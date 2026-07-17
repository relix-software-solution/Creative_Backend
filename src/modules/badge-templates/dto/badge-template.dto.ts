export type BadgeTemplateColorsDto = {
  primary?: string;
  text?: string;
  background?: string;
};

export type BadgeTemplateFieldDto = {
  key: string;
  source: string;
  label?: string;
  visible?: boolean;
};

export type BadgeTemplateLayoutDto = Record<string, unknown>;

export type UpsertBadgeTemplateDto = {
  eventId?: string;
  name?: string;
  widthMm?: number;
  heightMm?: number;
  backgroundImageUrl?: string;
  colors?: BadgeTemplateColorsDto;
  selectedFields?: BadgeTemplateFieldDto[];
  layout?: BadgeTemplateLayoutDto;
};
