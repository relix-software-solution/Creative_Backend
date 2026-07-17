import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { QrImageService } from './qr-image.service';

describe('QrImageService lifecycle', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'event-ops-qr-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('repeated QR generation overwrites deterministic file instead of creating duplicates', async () => {
    const service = new QrImageService({
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'STORAGE_UPLOAD_ROOT') {
          return tempRoot;
        }

        if (key === 'PORT') {
          return 3000;
        }

        return defaultValue;
      }),
    } as never);

    await service.generateRegistrationQrImage({
      registrationPublicId: 'REG_TEST_001',
      qrToken: 'first-token',
    });
    await service.generateRegistrationQrImage({
      registrationPublicId: 'REG_TEST_001',
      qrToken: 'second-token',
    });

    await expect(readdir(join(tempRoot, 'qr'))).resolves.toEqual([
      'REG_TEST_001.png',
    ]);
    const qrBuffer = await readFile(join(tempRoot, 'qr', 'REG_TEST_001.png'));

    await expect(sharp(qrBuffer).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
  }, 30000);
});
