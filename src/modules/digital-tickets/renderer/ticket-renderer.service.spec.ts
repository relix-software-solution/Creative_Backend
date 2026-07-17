import { mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { FontService } from './font.service';
import { SvgBuilderService } from './svg-builder.service';
import { TicketRendererService } from './ticket-renderer.service';

function createRenderer() {
  const fontService = new FontService();
  const svgBuilder = new SvgBuilderService(fontService);

  return {
    fontService,
    renderer: new TicketRendererService(svgBuilder),
  };
}

function expectPng(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString()).toBe('PNG');
}

describe('TicketRendererService', () => {
  it('prefers QR relativePath over absolute filePath', async () => {
    const svgBuilder = {
      build: jest.fn().mockResolvedValue(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      ),
    };
    const renderer = new TicketRendererService(svgBuilder as never);

    await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: {},
        elements: [],
      },
      fields: { fullName: 'Visitor One' },
      qrImage: {
        filePath: 'C:/absolute/qr.png',
        relativePath: '/uploads/qr/REG_001.png',
      },
    });

    expect(svgBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        qrImagePath: '/uploads/qr/REG_001.png',
      }),
    );
  });

  it('renders a text element', async () => {
    const { renderer } = createRenderer();
    const png = await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: { background: '#ffffff' },
        elements: [
          {
            type: 'TEXT',
            text: 'Welcome',
            position: 'CENTER',
            width: 300,
            height: 80,
            fontSize: 32,
            align: 'center',
          },
        ],
      },
      fields: {},
    });

    expectPng(png);
  });

  it('renders a field element', async () => {
    const { renderer } = createRenderer();
    const png = await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: {},
        elements: [{ type: 'FIELD', fieldKey: 'fullName', position: 'CENTER' }],
      },
      fields: { fullName: 'Visitor One' },
    });

    expectPng(png);
  });

  it('renders a QR element', async () => {
    const qrFile = join(await mkdtemp(join(tmpdir(), 'ticket-qr-')), 'qr.png');
    await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 4,
        background: '#000000',
      },
    })
      .png()
      .toFile(qrFile);

    const { renderer } = createRenderer();
    const png = await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: {},
        elements: [{ type: 'QR', position: 'CENTER', width: 96, height: 96 }],
      },
      fields: {},
      qrImage: { filePath: qrFile },
    });

    expectPng(png);
  });

  it('does not crash on Arabic text', async () => {
    const { renderer } = createRenderer();
    const png = await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: {},
        elements: [{ type: 'TEXT', text: 'مرحبا', position: 'CENTER' }],
      },
      fields: {},
    });

    expectPng(png);
  });

  it('falls back when a custom font is missing', async () => {
    const { fontService } = createRenderer();

    await expect(fontService.resolveFontFamily('MissingFont.ttf')).resolves.toBe(
      "'Almarai', sans-serif",
    );
  });

  it('can embed a relative upload image path', async () => {
    const uploadDir = join(process.cwd(), 'uploads', 'digital-tickets', 'test');
    const imagePath = join(uploadDir, 'renderer-test.png');
    await mkdir(uploadDir, { recursive: true });
    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(imagePath);

    const { renderer } = createRenderer();
    const png = await renderer.render({
      template: {
        widthPx: 400,
        heightPx: 240,
        backgroundImageUrl: null,
        theme: {},
        elements: [
          {
            type: 'IMAGE',
            value: '/uploads/digital-tickets/test/renderer-test.png',
            position: 'CENTER',
            width: 48,
            height: 48,
          },
        ],
      },
      fields: {},
    });

    expectPng(png);
  });
});
