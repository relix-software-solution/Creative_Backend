import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FontService } from './font.service';

describe('FontService', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'event-ops-fonts-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('embeds regular and bold fonts as data URIs', async () => {
    const regularPath = join(tempRoot, 'Almarai-Regular.ttf');
    const boldPath = join(tempRoot, 'Almarai-Bold.ttf');
    await writeFile(regularPath, Buffer.from('regular-font'));
    await writeFile(boldPath, Buffer.from('bold-font'));

    const service = new FontService({
      get: jest.fn((key: string, fallback: string) => {
        if (key === 'DIGITAL_TICKET_FONT_REGULAR_PATH') {
          return regularPath;
        }

        if (key === 'DIGITAL_TICKET_FONT_BOLD_PATH') {
          return boldPath;
        }

        return fallback;
      }),
    } as never);

    const css = await service.fontFaceCss();

    expect(css).toContain("font-family: 'Almarai'");
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
    expect(css).toContain(Buffer.from('regular-font').toString('base64'));
    expect(css).toContain(Buffer.from('bold-font').toString('base64'));
    expect(css).not.toContain(tempRoot);
  });

  it('reads font files once and reuses cached data', async () => {
    const regularPath = join(tempRoot, 'Almarai-Regular.ttf');
    const boldPath = join(tempRoot, 'Almarai-Bold.ttf');
    await writeFile(regularPath, Buffer.from('first-regular'));
    await writeFile(boldPath, Buffer.from('first-bold'));

    const service = new FontService({
      get: jest.fn((key: string, fallback: string) =>
        key === 'DIGITAL_TICKET_FONT_REGULAR_PATH'
          ? regularPath
          : key === 'DIGITAL_TICKET_FONT_BOLD_PATH'
            ? boldPath
            : fallback,
      ),
    } as never);

    const firstCss = await service.fontFaceCss();
    await writeFile(regularPath, Buffer.from('second-regular'));
    await writeFile(boldPath, Buffer.from('second-bold'));
    const secondCss = await service.fontFaceCss();

    expect(secondCss).toBe(firstCss);
    expect(secondCss).toContain(Buffer.from('first-regular').toString('base64'));
    expect(secondCss).not.toContain(
      Buffer.from('second-regular').toString('base64'),
    );
  });

  it('does not crash when font files are missing', async () => {
    const service = new FontService({
      get: jest.fn((key: string, fallback: string) =>
        key === 'DIGITAL_TICKET_FONT_REGULAR_PATH'
          ? join(tempRoot, 'missing-regular.ttf')
          : key === 'DIGITAL_TICKET_FONT_BOLD_PATH'
            ? join(tempRoot, 'missing-bold.ttf')
            : fallback,
      ),
    } as never);

    await expect(service.fontFaceCss()).resolves.toBe('');
    await expect(service.resolveFontFamily()).resolves.toBe(
      "'Almarai', sans-serif",
    );
  });
});
