import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';

const DEFAULT_FONT = 'Almarai';
const DEFAULT_REGULAR_PATH = 'assets/fonts/Almarai-Regular.ttf';
const DEFAULT_BOLD_PATH = 'assets/fonts/Almarai-Bold.ttf';

/**
 * نستخدم اسم الخط فقط داخل SVG.
 * الـ fallback يتولاه محرّك الرندر عند تعذر تحميل الخط.
 */
const FONT_FAMILY_CSS = 'Almarai';

type FontWeight = 400 | 700;

type FontData = {
  regular?: string;
  bold?: string;
};

@Injectable()
export class FontService {
  private static readonly warned = new Set<string>();

  private readonly logger = new Logger(FontService.name);
  private fontDataPromise?: Promise<FontData>;

  constructor(private readonly configService: ConfigService) {}

  async resolveFontFamily(_fontFamily?: string) {
    return FONT_FAMILY_CSS;
  }

  /**
   * يجب وضع @font-face داخل <style>.
   *
   * وجود @font-face مباشرة داخل <defs> لا يعتبر CSS صالحًا،
   * ولذلك كان Sharp/Librsvg يستخدم خط fallback بدل Almarai.
   */
  async fontFaceCss() {
    const fonts = await this.loadFonts();
    const rules: string[] = [];

    if (fonts.regular) {
      rules.push(this.fontFace(400, fonts.regular));
    }

    if (fonts.bold) {
      rules.push(this.fontFace(700, fonts.bold));
    } else if (fonts.regular) {
      rules.push(this.fontFace(700, fonts.regular));
    }

    if (rules.length === 0) {
      return '';
    }

    return [
      '<style type="text/css"><![CDATA[',
      rules.join('\n'),
      ']]></style>',
    ].join('\n');
  }

  get defaultFontFamily() {
    return DEFAULT_FONT;
  }

  get cssFontFamily() {
    return FONT_FAMILY_CSS;
  }

  private loadFonts() {
    if (!this.fontDataPromise) {
      this.fontDataPromise = this.readConfiguredFonts();
    }

    return this.fontDataPromise;
  }

  private async readConfiguredFonts(): Promise<FontData> {
    const regularPath = this.configService.get<string>(
      'DIGITAL_TICKET_FONT_REGULAR_PATH',
      DEFAULT_REGULAR_PATH,
    );

    const boldPath = this.configService.get<string>(
      'DIGITAL_TICKET_FONT_BOLD_PATH',
      DEFAULT_BOLD_PATH,
    );

    const regular = await this.readFontFile(400, regularPath);
    const bold = await this.readFontFile(700, boldPath);

    return {
      regular,
      bold,
    };
  }

  private async readFontFile(weight: FontWeight, configuredPath: string) {
    const absolutePath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(process.cwd(), configuredPath);

    try {
      const data = await readFile(absolutePath);

      return data.toString('base64');
    } catch {
      this.warnMissing(weight, absolutePath);

      return undefined;
    }
  }

  private warnMissing(weight: FontWeight, absolutePath: string) {
    const key = `${weight}:${absolutePath}`;

    if (FontService.warned.has(key)) {
      return;
    }

    FontService.warned.add(key);

    this.logger.warn(
      `Digital ticket Almarai ${weight} font file is unavailable at ${absolutePath}; using renderer fallback`,
    );
  }

  private fontFace(weight: FontWeight, base64: string) {
    return [
      '@font-face {',
      "  font-family: 'Almarai';",
      `  src: url("data:font/ttf;base64,${base64}") format("truetype");`,
      `  font-weight: ${weight};`,
      '  font-style: normal;',
      '  font-display: block;',
      '}',
    ].join('\n');
  }
}
