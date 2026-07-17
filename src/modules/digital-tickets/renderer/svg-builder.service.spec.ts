import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FontService } from './font.service';
import { SvgBuilderService } from './svg-builder.service';

const qrDataUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAFgwJ/lJ6vfwAAAABJRU5ErkJggg==';

function createBuilder() {
  return new SvgBuilderService(new FontService());
}

function attrs(svg: string, marker: string) {
  const match = svg.match(new RegExp(`<[^>]*${marker}[^>]*>`));
  expect(match?.[0]).toBeDefined();

  return Object.fromEntries(
    [...match![0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [
      key,
      value,
    ]),
  );
}

function numberAttr(svg: string, marker: string, name: string) {
  return Number(attrs(svg, marker)[name]);
}

function textAttrs(svg: string, text: string) {
  const match = svg.match(new RegExp(`<text[^>]*>[\\s\\S]*?${text}[\\s\\S]*?</text>`));
  expect(match?.[0]).toBeDefined();

  return Object.fromEntries(
    [...match![0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [
      key,
      value,
    ]),
  );
}

function sectionRectAttrs(svg: string, section: string) {
  const match = svg.match(
    new RegExp(
      `<g data-ticket-section="${section}">\\s*<rect([^>]*)>`,
    ),
  );
  expect(match?.[0]).toBeDefined();

  return Object.fromEntries(
    [...match![0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [
      key,
      value,
    ]),
  );
}

describe('SvgBuilderService digital ticket layout', () => {
  it('renders only the required ticket sections with compact QR geometry', async () => {
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [
        { type: 'FIELD', fieldKey: 'publicId' },
        { type: 'TEXT', text: 'Valid Until' },
      ],
      fields: {
        fullName: 'Visitor One',
        ticketLocale: 'en',
        eventDescription: 'Main event description',
        eventDateFormatted: '02 August 2026',
        eventTimeFormatted: '4:30 PM',
        publicId: 'REG_001',
        notes: 'Do not render',
      },
      qrImagePath: qrDataUri,
    });

    const qr = attrs(svg, 'data-ticket-qr="true"');
    const qrContainer = attrs(svg, 'data-ticket-qr-container="true"');
    const qrX = Number(qr.x);
    const qrY = Number(qr.y);
    const qrWidth = Number(qr.width);
    const qrHeight = Number(qr.height);
    const containerX = Number(qrContainer.x);
    const containerY = Number(qrContainer.y);
    const containerWidth = Number(qrContainer.width);
    const containerHeight = Number(qrContainer.height);

    expect(svg).toContain('Digital Entry Ticket');
    expect(svg).toContain('Visitor One');
    expect(svg).toContain('data-ticket-qr="true"');
    expect(svg).toContain(qrDataUri);
    expect(qrWidth).toBeGreaterThanOrEqual(320);
    expect(qrWidth).toBeLessThanOrEqual(380);
    expect(qrWidth).toBe(qrHeight);
    expect(containerWidth).toBe(containerHeight);
    expect(qrX).toBeGreaterThan(containerX);
    expect(qrY).toBeGreaterThan(containerY);
    expect(qrX + qrWidth).toBeLessThan(containerX + containerWidth);
    expect(qrY + qrHeight).toBeLessThan(containerY + containerHeight);
    expect(qrY).toBeGreaterThan(Number(textAttrs(svg, 'Visitor One').y));
    expect(svg).toContain('Main event description');
    expect(svg).toContain('02 August 2026');
    expect(svg).toContain('4:30 PM');
    expect(svg).toContain('font-family="\'Almarai\', sans-serif"');
    expect(svg).not.toContain('REG_001');
    expect(svg).not.toContain('Notes');
    expect(svg).not.toContain('Do not render');
    expect(svg).not.toContain('Valid Until');
    expect(svg).not.toContain('Issued At');
    expect(svg).not.toContain('All Times');
  });

  it('uses Arabic title for Arabic locale and English title for English locale', async () => {
    const arabic = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'ar',
        fullName: 'Visitor One',
      },
      qrImagePath: qrDataUri,
    });
    const english = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
      },
      qrImagePath: qrDataUri,
    });

    expect(arabic).toContain('بطاقة الدخول الرقمية');
    expect(arabic).not.toContain('Digital Entry Ticket');
    expect(english).toContain('Digital Entry Ticket');
    expect(english).not.toContain('بطاقة الدخول الرقمية');
  });

  it('renders visitor name bold and centered', async () => {
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
      },
      qrImagePath: qrDataUri,
    });
    const visitor = textAttrs(svg, 'Visitor One');

    expect(visitor['font-weight']).toBe('700');
    expect(visitor['text-anchor']).toBe('middle');
    expect(Number(visitor['font-size'])).toBeGreaterThanOrEqual(36);
    expect(Number(visitor['font-size'])).toBeLessThanOrEqual(44);
    expect(svg).not.toContain('text-decoration');
  });

  it('hides optional boxes when their values are empty', async () => {
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        fullName: 'Visitor One',
        eventDescription: '',
        eventDateFormatted: '',
        eventTimeFormatted: '',
      },
      qrImagePath: qrDataUri,
    });

    expect(svg).not.toContain('data-ticket-section="eventDescription"');
    expect(svg).not.toContain('data-ticket-section="eventDate"');
    expect(svg).not.toContain('data-ticket-section="eventTime"');
    expect(svg).not.toContain('Event Description');
    expect(svg).not.toContain('Event Date');
    expect(svg).not.toContain('Event Time');
  });

  it('centers date-only and time-only compact cards', async () => {
    const dateOnly = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDateFormatted: '02 August 2026',
      },
      qrImagePath: qrDataUri,
    });
    const timeOnly = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventTimeFormatted: '9:22 PM',
      },
      qrImagePath: qrDataUri,
    });

    const date = sectionRectAttrs(dateOnly, 'eventDate');
    const time = sectionRectAttrs(timeOnly, 'eventTime');

    expect(Number(date.x)).toBeGreaterThan(300);
    expect(Number(time.x)).toBeGreaterThan(300);
    expect(dateOnly).not.toContain('data-ticket-section="eventTime"');
    expect(timeOnly).not.toContain('data-ticket-section="eventDate"');
    expect(date.width).not.toBe('0');
    expect(time.width).not.toBe('0');
  });

  it('uses two compact cards when both date and time exist', async () => {
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDateFormatted: '02 August 2026',
        eventTimeFormatted: '9:22 PM',
      },
      qrImagePath: qrDataUri,
    });
    const date = sectionRectAttrs(svg, 'eventDate');
    const time = sectionRectAttrs(svg, 'eventTime');
    const dateX = Number(date.x);
    const timeX = Number(time.x);
    const dateWidth = Number(date.width);

    expect(svg).toContain('02 August 2026');
    expect(svg).toContain('9:22 PM');
    expect(dateWidth).toBeLessThan(460);
    expect(timeX).toBeGreaterThan(dateX + dateWidth);
  });

  it('renders decorative background behind dynamic content without depending on baked boxes', async () => {
    const background =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mO8e/fufwYGBgYGJgYABu8DA721C1sAAAAASUVORK5CYII=';
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      backgroundImageUrl: background,
      elements: [
        { type: 'TEXT', text: 'Baked Description Placeholder' },
        { type: 'FIELD', fieldKey: 'notes' },
      ],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDescription: '',
        eventDateFormatted: '',
        eventTimeFormatted: '',
        notes: 'Hidden note',
      },
      qrImagePath: qrDataUri,
    });
    const backgroundIndex = svg.indexOf(`href="${background}"`);
    const titleIndex = svg.indexOf('Digital Entry Ticket');
    const qrIndex = svg.indexOf('data-ticket-qr="true"');

    expect(backgroundIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeGreaterThan(backgroundIndex);
    expect(qrIndex).toBeGreaterThan(backgroundIndex);
    expect(svg).toContain('data-ticket-qr-container="true"');
    expect(svg).not.toContain('Baked Description Placeholder');
    expect(svg).not.toContain('Hidden note');
    expect(svg).not.toContain('data-ticket-section="eventDescription"');
    expect(svg).not.toContain('data-ticket-section="eventDate"');
    expect(svg).not.toContain('data-ticket-section="eventTime"');
  });

  it('renders only title, visitor name, and QR when optional values are empty', async () => {
    const svg = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDescription: '',
        eventDateFormatted: '',
        eventTimeFormatted: '',
      },
      qrImagePath: qrDataUri,
    });

    expect(svg).toContain('Digital Entry Ticket');
    expect(svg).toContain('Visitor One');
    expect(svg).toContain('data-ticket-section="qr"');
    expect(svg).not.toContain('data-ticket-section="eventDescription"');
    expect(svg).not.toContain('data-ticket-section="eventDate"');
    expect(svg).not.toContain('data-ticket-section="eventTime"');
  });

  it('repositions date and time upward when description is empty', async () => {
    const withDescription = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDescription: 'Main event description',
        eventDateFormatted: '02 August 2026',
        eventTimeFormatted: '9:22 PM',
      },
      qrImagePath: qrDataUri,
    });
    const withoutDescription = await createBuilder().build({
      width: 1080,
      height: 1920,
      backgroundColor: '#ffffff',
      elements: [],
      fields: {
        ticketLocale: 'en',
        fullName: 'Visitor One',
        eventDescription: '',
        eventDateFormatted: '02 August 2026',
        eventTimeFormatted: '9:22 PM',
      },
      qrImagePath: qrDataUri,
    });

    expect(
      Number(sectionRectAttrs(withoutDescription, 'eventDate').y),
    ).toBeLessThan(Number(sectionRectAttrs(withDescription, 'eventDate').y));
    expect(
      Number(sectionRectAttrs(withoutDescription, 'eventTime').y),
    ).toBeLessThan(Number(sectionRectAttrs(withDescription, 'eventTime').y));
  });

  it('does not embed unsafe absolute QR paths in generic template rendering', async () => {
    const svg = await createBuilder().build({
      width: 400,
      height: 240,
      backgroundColor: '#ffffff',
      elements: [{ type: 'QR', position: 'CENTER', width: 96, height: 96 }],
      fields: {},
      qrImagePath: 'C:/unsafe/qr.png',
    });

    expect(svg).not.toContain('C:/unsafe/qr.png');
    expect(svg).not.toContain('<image');
  });

  it('embeds configured Almarai font faces without exposing paths', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'event-ops-svg-fonts-'));
    const regularPath = join(tempRoot, 'Almarai-Regular.ttf');
    const boldPath = join(tempRoot, 'Almarai-Bold.ttf');

    try {
      await writeFile(regularPath, Buffer.from('regular-font'));
      await writeFile(boldPath, Buffer.from('bold-font'));

      const builder = new SvgBuilderService(
        new FontService({
          get: jest.fn((key: string, fallback: string) =>
            key === 'DIGITAL_TICKET_FONT_REGULAR_PATH'
              ? regularPath
              : key === 'DIGITAL_TICKET_FONT_BOLD_PATH'
                ? boldPath
                : fallback,
          ),
        } as never),
      );
      const svg = await builder.build({
        width: 1080,
        height: 1920,
        backgroundColor: '#ffffff',
        elements: [],
        fields: {
          fullName: 'Visitor One',
          eventDescription: '',
          eventDateFormatted: '',
          eventTimeFormatted: '',
        },
        qrImagePath: qrDataUri,
      });

      expect(svg).toContain('@font-face');
      expect(svg).toContain('font-weight: 400');
      expect(svg).toContain('font-weight: 700');
      expect(svg).toContain(Buffer.from('regular-font').toString('base64'));
      expect(svg).toContain(Buffer.from('bold-font').toString('base64'));
      expect(svg).not.toContain(tempRoot);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
