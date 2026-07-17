import { Logger } from '@nestjs/common';
import { safeDeleteUploadFile } from './upload-file.util';

describe('safeDeleteUploadFile', () => {
  const logger = {
    warn: jest.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects path traversal', async () => {
    await expect(
      safeDeleteUploadFile(
        '/uploads/event-branding/../secret.png',
        'event-branding',
        logger,
      ),
    ).resolves.toMatchObject({
      deleted: false,
      skipped: true,
      reason: 'UNSAFE_PATH',
    });
  });

  it('rejects absolute filesystem paths', async () => {
    await expect(
      safeDeleteUploadFile(
        'C:/tmp/secret.png',
        'event-branding',
        logger,
      ),
    ).resolves.toMatchObject({
      deleted: false,
      skipped: true,
      reason: 'ABSOLUTE_PATH',
    });
  });

  it('treats missing files as non-fatal', async () => {
    await expect(
      safeDeleteUploadFile(
        '/uploads/event-branding/missing.png',
        'event-branding',
        logger,
      ),
    ).resolves.toMatchObject({
      deleted: false,
      skipped: true,
      reason: 'NOT_FOUND',
    });
  });
});
