import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DigitalTicketImageService } from './digital-ticket-image.service';

describe('DigitalTicketImageService', () => {
  let uploadRoot: string;
  let service: DigitalTicketImageService;
  let prisma: { digitalTicketImage: { upsert: jest.Mock } };

  beforeEach(async () => {
    uploadRoot = await mkdtemp(join(tmpdir(), 'ticket-images-'));
    prisma = {
      digitalTicketImage: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({ id: 'image-1', ...create }),
        ),
      },
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'STORAGE_UPLOAD_ROOT') {
          return uploadRoot;
        }

        if (key === 'APP_PUBLIC_BASE_URL') {
          return 'https://example.com';
        }

        return fallback;
      }),
    };
    service = new DigitalTicketImageService(config as never, prisma as never);
  });

  afterEach(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it('saves generated image metadata without exposing registration ids in path', async () => {
    const result = await service.saveGeneratedImage({
      eventId: 'event-1',
      registrationId: 'registration-secret',
      templateId: 'template-1',
      templateVersion: 3,
      png: Buffer.from('png'),
    });

    expect(result.relativePath).toMatch(
      /^\/uploads\/digital-tickets\/generated\/.+\.png$/,
    );
    expect(result.relativePath).not.toContain('registration-secret');
    expect(prisma.digitalTicketImage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          registrationId_templateId_templateVersion: {
            registrationId: 'registration-secret',
            templateId: 'template-1',
            templateVersion: 3,
          },
        },
      }),
    );
  });

  it('detects missing or empty same-version generated files as unusable', async () => {
    const generatedDir = join(uploadRoot, 'digital-tickets', 'generated');
    await mkdir(generatedDir, { recursive: true });
    await writeFile(join(generatedDir, 'empty.png'), Buffer.alloc(0));
    await writeFile(join(generatedDir, 'valid.png'), Buffer.from('png'));

    await expect(
      service.isGeneratedImageUsable('/uploads/digital-tickets/generated/missing.png'),
    ).resolves.toBe(false);
    await expect(
      service.isGeneratedImageUsable('/uploads/digital-tickets/generated/empty.png'),
    ).resolves.toBe(false);
    await expect(
      service.isGeneratedImageUsable('/uploads/digital-tickets/generated/valid.png'),
    ).resolves.toBe(true);
    await expect(
      service.isGeneratedImageUsable('C:/unsafe/generated.png'),
    ).resolves.toBe(false);
  });
});
