import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { extname, normalize, resolve, sep } from 'path';
import { FontService } from './font.service';

export type TicketElementType = 'TEXT' | 'FIELD' | 'IMAGE' | 'QR';

export type TicketElementPosition =
  | 'TOP_LEFT'
  | 'TOP_CENTER'
  | 'TOP_RIGHT'
  | 'CENTER_LEFT'
  | 'CENTER'
  | 'CENTER_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_CENTER'
  | 'BOTTOM_RIGHT';

export type TicketElement = {
  id?: string;
  type?: TicketElementType | string;
  position?: TicketElementPosition | string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right' | string;
  text?: string;
  value?: string;
  fieldKey?: string;
  key?: string;
  source?: string;
};

type BrandingTheme = {
  primary?: string;
  primaryHover?: string;
  background?: string;
  text?: string;
  radius?: string;
};

export type BuildSvgInput = {
  width: number;
  height: number;
  backgroundColor?: string;
  backgroundImageUrl?: string | null;
  elements: TicketElement[];
  fields: Record<string, unknown>;
  qrImagePath?: string | null;
  branding?: {
    logoUrl?: string | null;
    backgroundImageUrl?: string | null;
    theme?: unknown;
  } | null;
};

@Injectable()
export class SvgBuilderService {
  constructor(private readonly fontService: FontService) {}

  async build(input: BuildSvgInput) {
    if (this.shouldUseDigitalTicketLayout(input)) {
      return this.buildDigitalTicket(input);
    }

    return this.buildGenericTemplate(input);
  }

  private async buildDigitalTicket(input: BuildSvgInput) {
    const width = input.width;
    const height = input.height;

    const theme = this.resolveTheme(input);

    const fullName = this.stringify(input.fields.fullName).trim();

    const eventDate = this.stringify(
      input.fields.eventDateRangeFormatted || input.fields.eventDateFormatted,
    ).trim();

    const eventTime = this.stringify(
      input.fields.eventTimeRangeFormatted || input.fields.eventTimeFormatted,
    ).trim();

    const qr = await this.toImageDataUri(input.qrImagePath);

    const logo = await this.toImageDataUri(input.branding?.logoUrl);

    if (!fullName) {
      throw new Error('Digital ticket visitor name is required');
    }

    if (!qr) {
      throw new Error('Digital ticket QR image is required');
    }

    /**
     * Reference canvas:
     * 1080 × 1920
     */
    const scaleX = width / 1080;
    const scaleY = height / 1920;
    const scale = Math.min(scaleX, scaleY);

    const sx = (value: number) => Math.round(value * scaleX);

    const sy = (value: number) => Math.round(value * scaleY);

    const ss = (value: number) => Math.round(value * scale);

    const outerX = sx(72);
    const outerY = sy(44);

    const outerWidth = width - outerX * 2;
    const outerHeight = height - outerY * 2;
    const outerRadius = ss(54);

    /**
     * الهيدر أصبح أكبر قليلًا حتى يظهر اللوغو
     * بشكل واضح ومرتب.
     */
    const headerHeight = sy(330);

    const visitorLabelY = outerY + headerHeight + sy(66);

    const visitorNameY = visitorLabelY + sy(38);

    /**
     * حذفنا اسم الفعالية، ولذلك يصعد QR للأعلى.
     */
    const qrContainerX = sx(165);
    const qrContainerY = visitorNameY + sy(125);

    const qrContainerWidth = width - qrContainerX * 2;

    const qrContainerHeight = sy(680);
    const qrContainerRadius = ss(48);

    const qrPadding = ss(78);

    const qrSize = Math.min(
      qrContainerWidth - qrPadding * 2,
      qrContainerHeight - qrPadding * 2,
    );

    const qrX = Math.round((width - qrSize) / 2);

    const qrY = qrContainerY + Math.round((qrContainerHeight - qrSize) / 2);

    const cardsGap = sx(28);
    const cardsMarginX = sx(108);

    const hasTime = Boolean(eventTime);
    const hasDate = Boolean(eventDate);
    const infoCount = Number(hasTime) + Number(hasDate);

    const infoCardHeight = sy(280);

    const infoCardWidth =
      infoCount <= 1
        ? width - cardsMarginX * 2
        : Math.floor((width - cardsMarginX * 2 - cardsGap) / 2);

    const infoCardsY = qrContainerY + qrContainerHeight + sy(72);

    const timeCardX = cardsMarginX;

    const dateCardX =
      hasTime && hasDate ? timeCardX + infoCardWidth + cardsGap : cardsMarginX;

    const fontCss = await this.styleElement();

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,

      '<defs>',

      fontCss,

      `<linearGradient id="headerGradient" x1="0" y1="0" x2="1" y2="1">`,
      `<stop offset="0%" stop-color="${this.escapeAttr(theme.primary)}"/>`,
      `<stop offset="100%" stop-color="${this.escapeAttr(
        theme.primaryHover,
      )}"/>`,
      '</linearGradient>',

      `<linearGradient id="separatorGradient" x1="0" y1="0" x2="1" y2="0">`,
      `<stop offset="0%" stop-color="${this.escapeAttr(theme.primaryHover)}"/>`,
      `<stop offset="50%" stop-color="#ffffff" stop-opacity="0.92"/>`,
      `<stop offset="100%" stop-color="${this.escapeAttr(theme.primary)}"/>`,
      '</linearGradient>',

      '<filter id="mainShadow" x="-20%" y="-20%" width="140%" height="150%">',
      '<feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#000000" flood-opacity="0.13"/>',
      '</filter>',

      '<filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">',
      '<feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.10"/>',
      '</filter>',

      '<filter id="logoShadow" x="-20%" y="-20%" width="140%" height="150%">',
      '<feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.14"/>',
      '</filter>',

      `<pattern id="arabesquePattern" width="${ss(95)}" height="${ss(
        95,
      )}" patternUnits="userSpaceOnUse">`,

      `<path d="M ${ss(47)} 0 L ${ss(95)} ${ss(47)} L ${ss(47)} ${ss(
        95,
      )} L 0 ${ss(47)} Z" fill="none" stroke="#ffffff" stroke-width="${Math.max(
        1,
        ss(1.2),
      )}" opacity="0.14"/>`,

      `<circle cx="${ss(47)}" cy="${ss(47)}" r="${ss(
        18,
      )}" fill="none" stroke="#ffffff" stroke-width="${Math.max(
        1,
        ss(1),
      )}" opacity="0.10"/>`,

      '</pattern>',
      '</defs>',

      /**
       * خلفية الصورة.
       */
      `<rect width="100%" height="100%" fill="${this.escapeAttr(
        theme.background,
      )}"/>`,

      /**
       * زخارف خارجية خفيفة.
       */
      `<circle cx="${sx(82)}" cy="${sy(100)}" r="${ss(
        170,
      )}" fill="${this.escapeAttr(theme.primary)}" opacity="0.07"/>`,

      `<circle cx="${width - sx(32)}" cy="${height - sy(58)}" r="${ss(
        230,
      )}" fill="${this.escapeAttr(theme.primaryHover)}" opacity="0.055"/>`,

      `<rect x="${sx(38)}" y="${sy(88)}" width="${sx(6)}" height="${
        height - sy(176)
      }" rx="${sx(3)}" fill="${this.escapeAttr(
        theme.primary,
      )}" opacity="0.12"/>`,

      `<rect x="${sx(52)}" y="${sy(88)}" width="${sx(3)}" height="${
        height - sy(176)
      }" rx="${sx(2)}" fill="${this.escapeAttr(
        theme.primary,
      )}" opacity="0.07"/>`,

      /**
       * البطاقة البيضاء الرئيسية.
       */
      '<g filter="url(#mainShadow)">',

      `<rect x="${outerX}" y="${outerY}" width="${outerWidth}" height="${outerHeight}" rx="${outerRadius}" fill="#ffffff"/>`,

      '</g>',

      /**
       * الهيدر الملون.
       */
      `<path d="${this.headerPath(
        outerX,
        outerY,
        outerWidth,
        headerHeight,
        outerRadius,
        sy(34),
      )}" fill="url(#headerGradient)"/>`,

      `<path d="${this.headerPath(
        outerX,
        outerY,
        outerWidth,
        headerHeight,
        outerRadius,
        sy(34),
      )}" fill="url(#arabesquePattern)" opacity="0.35"/>`,

      /**
       * فاصل منحني خفيف.
       */
      `<path d="M ${outerX} ${outerY + headerHeight - sy(34)} Q ${Math.round(
        width / 2,
      )} ${outerY + headerHeight + sy(18)} ${outerX + outerWidth} ${
        outerY + headerHeight - sy(34)
      }" fill="none" stroke="url(#separatorGradient)" stroke-width="${ss(
        12,
      )}" opacity="0.9"/>`,

      `<path d="M ${outerX} ${outerY + headerHeight - sy(20)} Q ${Math.round(
        width / 2,
      )} ${outerY + headerHeight + sy(34)} ${outerX + outerWidth} ${
        outerY + headerHeight - sy(20)
      }" fill="none" stroke="#ffffff" stroke-width="${ss(22)}"/>`,
    ];

    /**
     * لوغو الفعالية داخل الهيدر.
     */
    if (logo) {
      const logoBoxWidth = sx(600);
      const logoBoxHeight = sy(250);

      const logoBoxX = Math.round((width - logoBoxWidth) / 2);

      const logoBoxY = outerY + sy(30);

      const logoPaddingX = sx(34);
      const logoPaddingY = sy(24);

      parts.push(
        '<g filter="url(#logoShadow)">',

        `<rect x="${logoBoxX}" y="${logoBoxY}" width="${logoBoxWidth}" height="${logoBoxHeight}" rx="${ss(
          34,
        )}" fill="#ffffff" fill-opacity="0.94" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${ss(
          2,
        )}"/>`,

        `<image href="${logo}" x="${logoBoxX + logoPaddingX}" y="${
          logoBoxY + logoPaddingY
        }" width="${logoBoxWidth - logoPaddingX * 2}" height="${
          logoBoxHeight - logoPaddingY * 2
        }" preserveAspectRatio="xMidYMid meet"/>`,

        '</g>',
      );
    } else {
      parts.push(
        this.emblem({
          centerX: Math.round(width / 2),
          centerY: outerY + sy(112),
          size: ss(82),
        }),
      );
    }

    /**
     * عنوان صغير فوق اسم الزائر.
     */
    parts.push(
      await this.textBlock({
        x: outerX + sx(110),
        y: visitorLabelY,
        width: outerWidth - sx(220),
        text: 'اسم الزائر',
        fontSize: ss(23),
        weight: 400,
        color: theme.primaryHover,
        opacity: 0.82,
        align: 'center',
        maxLines: 1,
      }),
    );

    /**
     * اسم الزائر.
     */
    parts.push(
      await this.textBlock({
        x: outerX + sx(90),
        y: visitorNameY,
        width: outerWidth - sx(180),
        text: fullName,
        fontSize: ss(58),
        weight: 700,
        color: theme.text,
        align: 'center',
        maxLines: 1,
      }),
    );

    /**
     * QR بدون تغيير محتواه.
     */
    parts.push(
      '<g data-ticket-section="qr" filter="url(#softShadow)">',

      `<rect x="${qrContainerX}" y="${qrContainerY}" width="${qrContainerWidth}" height="${qrContainerHeight}" rx="${qrContainerRadius}" fill="#ffffff" stroke="${this.escapeAttr(
        theme.primary,
      )}" stroke-opacity="0.24" stroke-width="${ss(3)}"/>`,

      `<image data-ticket-qr="true" href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" style="image-rendering: pixelated; image-rendering: crisp-edges;"/>`,

      '</g>',
    );

    /**
     * الوقت.
     */
    if (eventTime) {
      parts.push(
        this.infoCard({
          section: 'time',
          x: timeCardX,
          y: infoCardsY,
          width: infoCardWidth,
          height: infoCardHeight,
          label: 'الوقت',
          value: eventTime,
          icon: 'clock',
          theme,
          scale,
        }),
      );
    }

    /**
     * التاريخ.
     */
    if (eventDate) {
      parts.push(
        this.infoCard({
          section: 'date',
          x: dateCardX,
          y: infoCardsY,
          width: infoCardWidth,
          height: infoCardHeight,
          label: 'التاريخ',
          value: eventDate,
          icon: 'calendar',
          theme,
          scale,
        }),
      );
    }

    parts.push('</svg>');

    return parts.join('');
  }

  private infoCard(input: {
    section: 'time' | 'date';
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    value: string;
    icon: 'clock' | 'calendar';
    theme: Required<BrandingTheme>;
    scale: number;
  }) {
    const ss = (value: number) => Math.round(value * input.scale);

    const radius = ss(34);

    const centerX = input.x + input.width / 2;

    const iconCenterY = input.y + ss(61);

    const labelY = input.y + ss(120);

    const valueY = input.y + ss(194);

    const iconSvg =
      input.icon === 'clock'
        ? this.clockIcon(centerX, iconCenterY, ss(31), input.theme.primary)
        : this.calendarIcon(centerX, iconCenterY, ss(31), input.theme.primary);

    const lineWidth = ss(70);
    const lineGap = ss(48);

    /**
     * نطاق التاريخ أطول من الوقت، لذلك نصغّر
     * الخط تلقائيًا حسب طول القيمة.
     */
    const valueFontSize =
      input.value.length > 24
        ? ss(24)
        : input.value.length > 19
          ? ss(27)
          : input.value.length > 15
            ? ss(30)
            : ss(34);

    return [
      `<g data-ticket-section="${input.section}">`,

      `<rect x="${input.x}" y="${input.y}" width="${input.width}" height="${input.height}" rx="${radius}" fill="#ffffff" stroke="${this.escapeAttr(
        input.theme.primary,
      )}" stroke-opacity="0.22" stroke-width="${ss(2)}"/>`,

      iconSvg,

      `<line x1="${centerX - lineGap - lineWidth}" y1="${labelY - ss(9)}" x2="${
        centerX - lineGap
      }" y2="${labelY - ss(9)}" stroke="${this.escapeAttr(
        input.theme.primary,
      )}" stroke-width="${ss(2)}" opacity="0.48"/>`,

      `<line x1="${centerX + lineGap}" y1="${labelY - ss(9)}" x2="${
        centerX + lineGap + lineWidth
      }" y2="${labelY - ss(9)}" stroke="${this.escapeAttr(
        input.theme.primary,
      )}" stroke-width="${ss(2)}" opacity="0.48"/>`,

      `<text x="${centerX}" y="${labelY}" font-family="${this.escapeAttr(
        this.fontService.cssFontFamily,
      )}" font-size="${ss(24)}" font-weight="700" fill="${this.escapeAttr(
        input.theme.primaryHover,
      )}" text-anchor="middle" direction="rtl">${this.escapeText(
        input.label,
      )}</text>`,

      `<text x="${centerX}" y="${valueY}" font-family="${this.escapeAttr(
        this.fontService.cssFontFamily,
      )}" font-size="${valueFontSize}" font-weight="700" fill="${this.escapeAttr(
        input.theme.text,
      )}" text-anchor="middle" direction="ltr" unicode-bidi="plaintext">${this.escapeText(
        input.value,
      )}</text>`,

      '</g>',
    ].join('');
  }

  private emblem(input: { centerX: number; centerY: number; size: number }) {
    const radius = input.size / 2;
    const stroke = Math.max(2, Math.round(input.size * 0.07));

    const rays = Array.from({ length: 8 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 8;
      const inner = radius * 0.55;
      const outer = radius * 0.92;

      const x1 = input.centerX + Math.cos(angle) * inner;
      const y1 = input.centerY + Math.sin(angle) * inner;
      const x2 = input.centerX + Math.cos(angle) * outer;
      const y2 = input.centerY + Math.sin(angle) * outer;

      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round"/>`;
    }).join('');

    return [
      '<g opacity="0.96">',
      rays,
      `<circle cx="${input.centerX}" cy="${input.centerY}" r="${
        radius * 0.28
      }" fill="none" stroke="#ffffff" stroke-width="${stroke}"/>`,
      `<path d="M ${input.centerX - radius * 0.23} ${
        input.centerY + radius * 0.18
      } L ${input.centerX + radius * 0.23} ${
        input.centerY - radius * 0.18
      }" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round"/>`,
      '</g>',
    ].join('');
  }

  private clockIcon(
    centerX: number,
    centerY: number,
    radius: number,
    color: string,
  ) {
    const strokeWidth = Math.max(2, Math.round(radius * 0.11));

    return [
      '<g>',
      `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}"/>`,
      `<line x1="${centerX}" y1="${centerY}" x2="${centerX}" y2="${
        centerY - radius * 0.55
      }" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      `<line x1="${centerX}" y1="${centerY}" x2="${
        centerX + radius * 0.44
      }" y2="${centerY + radius * 0.22}" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      '</g>',
    ].join('');
  }

  private calendarIcon(
    centerX: number,
    centerY: number,
    radius: number,
    color: string,
  ) {
    const width = radius * 1.65;
    const height = radius * 1.5;
    const x = centerX - width / 2;
    const y = centerY - height / 2;
    const strokeWidth = Math.max(2, Math.round(radius * 0.1));

    return [
      '<g>',
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${
        radius * 0.18
      }" fill="none" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}"/>`,
      `<line x1="${x}" y1="${y + height * 0.34}" x2="${
        x + width
      }" y2="${y + height * 0.34}" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}"/>`,
      `<line x1="${x + width * 0.26}" y1="${y - radius * 0.18}" x2="${
        x + width * 0.26
      }" y2="${y + radius * 0.2}" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      `<line x1="${x + width * 0.74}" y1="${y - radius * 0.18}" x2="${
        x + width * 0.74
      }" y2="${y + radius * 0.2}" stroke="${this.escapeAttr(
        color,
      )}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      `<circle cx="${x + width * 0.28}" cy="${
        y + height * 0.62
      }" r="${radius * 0.07}" fill="${this.escapeAttr(color)}"/>`,
      `<circle cx="${x + width * 0.5}" cy="${
        y + height * 0.62
      }" r="${radius * 0.07}" fill="${this.escapeAttr(color)}"/>`,
      `<circle cx="${x + width * 0.72}" cy="${
        y + height * 0.62
      }" r="${radius * 0.07}" fill="${this.escapeAttr(color)}"/>`,
      '</g>',
    ].join('');
  }

  private headerPath(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    curveDepth: number,
  ) {
    const right = x + width;
    const bottom = y + height;

    return [
      `M ${x + radius} ${y}`,
      `H ${right - radius}`,
      `Q ${right} ${y} ${right} ${y + radius}`,
      `V ${bottom - curveDepth}`,
      `Q ${x + width / 2} ${bottom + curveDepth} ${x} ${bottom - curveDepth}`,
      `V ${y + radius}`,
      `Q ${x} ${y} ${x + radius} ${y}`,
      'Z',
    ].join(' ');
  }

  private async buildGenericTemplate(input: BuildSvgInput) {
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">`,
      '<defs>',
      await this.styleElement(),
      '</defs>',
      `<rect width="100%" height="100%" fill="${this.escapeAttr(
        input.backgroundColor ?? '#ffffff',
      )}"/>`,
    ];

    const background = await this.toImageDataUri(
      input.backgroundImageUrl ?? input.branding?.backgroundImageUrl,
    );

    if (background) {
      parts.push(
        `<image href="${background}" x="0" y="0" width="${input.width}" height="${input.height}" preserveAspectRatio="xMidYMid slice"/>`,
      );
    }

    for (const element of input.elements) {
      const type = this.normalizeType(element.type);

      if (type === 'TEXT') {
        parts.push(
          await this.textElement(input, element, this.resolveText(element)),
        );
      } else if (type === 'FIELD') {
        const key = element.fieldKey ?? element.key;

        parts.push(
          await this.textElement(
            input,
            element,
            this.stringify(input.fields[key ?? '']),
          ),
        );
      } else if (type === 'QR') {
        const qr = await this.toImageDataUri(input.qrImagePath);

        if (qr) {
          parts.push(this.imageElement(input, element, qr, 'xMidYMid meet'));
        }
      } else if (type === 'IMAGE') {
        const image = await this.toImageDataUri(
          this.resolveImageSource(element, input),
        );

        if (image) {
          parts.push(this.imageElement(input, element, image, 'xMidYMid meet'));
        }
      }
    }

    parts.push('</svg>');

    return parts.join('');
  }

  private async textBlock(input: {
    x: number;
    y: number;
    width: number;
    text: string;
    fontSize: number;
    weight: number;
    color: string;
    opacity?: number;
    align: 'left' | 'center' | 'right';
    maxLines?: number;
  }) {
    const fontFamily = await this.fontService.resolveFontFamily();

    const anchor =
      input.align === 'center'
        ? 'middle'
        : input.align === 'right'
          ? 'end'
          : 'start';

    const x =
      input.align === 'center'
        ? input.x + input.width / 2
        : input.align === 'right'
          ? input.x + input.width
          : input.x;

    const direction = this.hasArabic(input.text) ? 'rtl' : 'ltr';

    const lines = this.wrapText(
      input.text,
      input.width,
      input.fontSize,
      input.maxLines ?? 1,
    );

    const lineHeight = Math.round(input.fontSize * 1.25);

    const tspans = lines
      .map(
        (line, index) =>
          `<tspan x="${x}" dy="${
            index === 0 ? 0 : lineHeight
          }">${this.escapeText(line)}</tspan>`,
      )
      .join('');

    return [
      `<text x="${x}" y="${input.y + input.fontSize}"`,
      `font-family="${this.escapeAttr(
        fontFamily,
      )}" font-size="${input.fontSize}" font-weight="${input.weight}"`,
      `fill="${this.escapeAttr(input.color)}" fill-opacity="${
        input.opacity ?? 1
      }" text-anchor="${anchor}" direction="${direction}">`,
      tspans,
      '</text>',
    ].join(' ');
  }

  private shouldUseDigitalTicketLayout(input: BuildSvgInput) {
    /**
     * لم نعد نعرض اسم الفعالية، لذلك لا يجب أن يكون
     * eventName شرطًا لاستخدام التصميم.
     */
    return Boolean(
      input.qrImagePath && this.stringify(input.fields.fullName).trim(),
    );
  }

  private async textElement(
    input: BuildSvgInput,
    element: TicketElement,
    text: string,
  ) {
    const box = this.resolveBox(input, element);
    const fontSize = this.positiveNumber(element.fontSize, 36);

    const fontFamily = await this.fontService.resolveFontFamily(
      element.fontFamily,
    );

    const weight = element.bold ? 700 : 400;
    const align = this.normalizeAlign(element.align);

    const anchor =
      align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';

    const x =
      align === 'center'
        ? box.x + box.width / 2
        : align === 'right'
          ? box.x + box.width
          : box.x;

    const y = box.y + fontSize;
    const direction = this.hasArabic(text) ? 'rtl' : 'ltr';

    return [
      `<text x="${x}" y="${y}" width="${box.width}" height="${box.height}"`,
      `font-family="${this.escapeAttr(
        fontFamily,
      )}" font-size="${fontSize}" font-weight="${weight}"`,
      `fill="${this.escapeAttr(
        element.color ?? '#222222',
      )}" text-anchor="${anchor}" direction="${direction}">`,
      this.escapeText(text),
      '</text>',
    ].join(' ');
  }

  private async styleElement() {
    return this.fontService.fontFaceCss();
  }

  private imageElement(
    input: BuildSvgInput,
    element: TicketElement,
    dataUri: string,
    preserveAspectRatio: string,
  ) {
    const box = this.resolveBox(input, element);

    return `<image href="${dataUri}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="${preserveAspectRatio}"/>`;
  }

  private resolveBox(input: BuildSvgInput, element: TicketElement) {
    const width = this.positiveNumber(element.width ?? element.w, 240);
    const height = this.positiveNumber(element.height ?? element.h, 80);

    const point = this.resolvePosition(
      input.width,
      input.height,
      width,
      height,
      element.position,
    );

    return {
      x: this.finiteNumber(element.x, point.x),
      y: this.finiteNumber(element.y, point.y),
      width,
      height,
    };
  }

  private resolvePosition(
    canvasWidth: number,
    canvasHeight: number,
    width: number,
    height: number,
    position?: string,
  ) {
    const margin = 48;
    const centerX = (canvasWidth - width) / 2;
    const centerY = (canvasHeight - height) / 2;
    const right = canvasWidth - width - margin;
    const bottom = canvasHeight - height - margin;

    switch (position) {
      case 'TOP_CENTER':
        return { x: centerX, y: margin };

      case 'TOP_RIGHT':
        return { x: right, y: margin };

      case 'CENTER_LEFT':
        return { x: margin, y: centerY };

      case 'CENTER':
        return { x: centerX, y: centerY };

      case 'CENTER_RIGHT':
        return { x: right, y: centerY };

      case 'BOTTOM_LEFT':
        return { x: margin, y: bottom };

      case 'BOTTOM_CENTER':
        return { x: centerX, y: bottom };

      case 'BOTTOM_RIGHT':
        return { x: right, y: bottom };

      case 'TOP_LEFT':
      default:
        return { x: margin, y: margin };
    }
  }

  private async toImageDataUri(value?: string | null) {
    if (!value) {
      return null;
    }

    if (value.startsWith('data:')) {
      return value;
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    const absolutePath = this.toSafeUploadPath(value);

    if (!absolutePath) {
      return null;
    }

    try {
      const data = await readFile(absolutePath);
      const mime = this.mimeType(absolutePath);

      return `data:${mime};base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private toSafeUploadPath(value: string) {
    const normalized = normalize(value.replace(/^\/+/, ''));

    if (!normalized.startsWith(`uploads${sep}`) && normalized !== 'uploads') {
      return null;
    }

    const uploadsRoot = resolve(process.cwd(), 'uploads');
    const absolute = resolve(process.cwd(), normalized);

    if (
      absolute !== uploadsRoot &&
      !absolute.startsWith(`${uploadsRoot}${sep}`)
    ) {
      return null;
    }

    return absolute;
  }

  private resolveImageSource(element: TicketElement, input: BuildSvgInput) {
    if (element.source === 'branding.logoUrl') {
      return input.branding?.logoUrl;
    }

    if (element.source === 'branding.backgroundImageUrl') {
      return input.branding?.backgroundImageUrl;
    }

    return element.value ?? element.text;
  }

  private resolveText(element: TicketElement) {
    return element.text ?? element.value ?? '';
  }

  private normalizeType(type: unknown): TicketElementType {
    const value = typeof type === 'string' ? type.toUpperCase() : 'TEXT';

    if (value === 'FIELD' || value === 'IMAGE' || value === 'QR') {
      return value;
    }

    return 'TEXT';
  }

  private normalizeAlign(align: unknown) {
    return align === 'center' || align === 'right' ? align : 'left';
  }

  private positiveNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  }

  private finiteNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private stringify(value: unknown) {
    if (value === undefined || value === null) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === 'string' ? value : String(value);
  }

  private resolveTheme(input: BuildSvgInput): Required<BrandingTheme> {
    const brandingTheme = this.toRecord(input.branding?.theme);
    const templateTheme = this.toRecord(input.fields.ticketTheme);

    return {
      primary: this.validColor(
        brandingTheme.primary,
        this.validColor(templateTheme.primary, '#B38A49'),
      ),

      primaryHover: this.validColor(
        brandingTheme.primaryHover,
        this.validColor(templateTheme.primaryHover, '#9D7538'),
      ),

      background: this.validColor(
        brandingTheme.background,
        this.validColor(
          input.backgroundColor,
          this.validColor(templateTheme.background, '#F8F3EA'),
        ),
      ),

      text: this.validColor(
        brandingTheme.text,
        this.validColor(templateTheme.text, '#17233A'),
      ),

      radius:
        typeof brandingTheme.radius === 'string'
          ? brandingTheme.radius
          : '1.5rem',
    };
  }

  private validColor(value: unknown, fallback: string) {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      return value;
    }

    return fallback;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private wrapText(
    value: string,
    width: number,
    fontSize: number,
    maxLines: number,
  ) {
    const text = value.trim();

    if (!text) {
      return [''];
    }

    const maxChars = Math.max(8, Math.floor(width / (fontSize * 0.56)));

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;

      if (next.length <= maxChars) {
        current = next;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      current = word;

      if (lines.length >= maxLines) {
        break;
      }
    }

    if (current && lines.length < maxLines) {
      lines.push(current);
    }

    if (lines.length === 0) {
      lines.push(text.slice(0, maxChars));
    }

    if (
      lines.length === maxLines &&
      words.join(' ').length > lines.join(' ').length
    ) {
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\.*$/, '')}…`;
    }

    return lines;
  }

  private hasArabic(value: string) {
    return /[\u0600-\u06ff]/.test(value);
  }

  private mimeType(path: string) {
    const extension = extname(path).toLowerCase();

    if (extension === '.jpg' || extension === '.jpeg') {
      return 'image/jpeg';
    }

    if (extension === '.webp') {
      return 'image/webp';
    }

    return 'image/png';
  }

  private escapeText(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private escapeAttr(value: string) {
    return this.escapeText(value).replace(/"/g, '&quot;');
  }
}
