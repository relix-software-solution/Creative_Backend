import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { SvgBuilderService, TicketElement } from './svg-builder.service';

export type RenderTicketInput = {
  template: {
    widthPx: number;
    heightPx: number;
    backgroundImageUrl?: string | null;
    theme: unknown;
    elements: unknown;
  };
  branding?: {
    logoUrl?: string | null;
    backgroundImageUrl?: string | null;
    theme?: unknown;
  } | null;
  qrImage?: {
    filePath?: string;
    imageUrl?: string;
    relativePath?: string;
  } | null;
  fields: Record<string, unknown>;
};

@Injectable()
export class TicketRendererService {
  constructor(private readonly svgBuilder: SvgBuilderService) {}

  async render(input: RenderTicketInput) {
    const svg = await this.svgBuilder.build({
      width: input.template.widthPx,
      height: input.template.heightPx,
      backgroundColor: this.resolveBackgroundColor(
        input.branding?.theme,
        input.template.theme,
      ),
      /*
       * The fixed Digital Ticket design is built fully in SVG.
       * Uploaded template backgrounds are intentionally not used for the
       * functional ticket layout because baked boxes cannot be hidden or
       * repositioned safely.
       */
      backgroundImageUrl: null,
      elements: this.toElements(input.template.elements),
      fields: {
        ...input.fields,
        ticketTheme: input.template.theme,
      },
      qrImagePath:
        input.qrImage?.relativePath ??
        input.qrImage?.imageUrl ??
        input.qrImage?.filePath,
      branding: input.branding,
    });

    return sharp(Buffer.from(svg))
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer();
  }

  private toElements(value: unknown): TicketElement[] {
    return Array.isArray(value)
      ? value.filter(
          (item): item is TicketElement =>
            typeof item === 'object' &&
            item !== null &&
            !Array.isArray(item),
        )
      : [];
  }

  private resolveBackgroundColor(
    brandingTheme: unknown,
    templateTheme: unknown,
  ) {
    const branding = this.toRecord(brandingTheme);
    const template = this.toRecord(templateTheme);

    if (typeof branding.background === 'string') {
      return branding.background;
    }

    if (typeof template.background === 'string') {
      return template.background;
    }

    return '#F8F3EA';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}