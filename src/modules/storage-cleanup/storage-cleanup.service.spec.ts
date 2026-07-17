import { BadRequestException } from '@nestjs/common';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageCleanupScope } from './dto/storage-cleanup.dto';
import { StorageCleanupService } from './storage-cleanup.service';

describe('StorageCleanupService', () => {
  let tempRoot: string;

  const createService = (prismaOverrides: Record<string, unknown> = {}) => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'STORAGE_UPLOAD_ROOT') {
          return tempRoot;
        }

        if (key === 'QR_IMAGE_RETENTION_DAYS') {
          return 30;
        }

        return defaultValue;
      }),
    };
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };
    const prisma = {
      registration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      event: {
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      ...prismaOverrides,
    };

    return {
      prisma,
      queue,
      service: new StorageCleanupService(
        configService as never,
        queue as never,
        prisma as never,
      ),
    };
  };

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'event-ops-storage-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects path traversal', async () => {
    const { service } = createService();

    await expect(
      service.safeDeleteRelativePath('/uploads/qr/../secret.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects absolute filesystem paths', async () => {
    const { service } = createService();

    await expect(
      service.safeDeleteRelativePath('C:/tmp/secret.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats missing files as non-fatal cleanup', async () => {
    const { service } = createService();

    await expect(
      service.safeDeleteMany(['/uploads/qr/REG_MISSING.png']),
    ).resolves.toMatchObject({
      scannedFiles: 1,
      deletedFiles: 0,
      missingFiles: 1,
      errors: [],
    });
  });

  it('dry-run never deletes candidate files', async () => {
    const qrDir = join(tempRoot, 'qr');
    await writeFile(join(await mkdirp(qrDir), 'REG_ORPHAN.png'), 'png');
    const { service } = createService();

    const result = await service.previewStorageCleanup({
      scope: StorageCleanupScope.QR_ORPHANS,
    });

    expect(result).toMatchObject({
      dryRun: true,
      scannedFiles: 1,
      candidateFiles: 1,
    });
    await expect(readFile(join(qrDir, 'REG_ORPHAN.png'), 'utf8')).resolves.toBe(
      'png',
    );
  });

  it('orphan QR detection only includes matching QR PNG files', async () => {
    const qrDir = await mkdirp(join(tempRoot, 'qr'));
    await writeFile(join(qrDir, 'REG_ORPHAN.png'), 'png');
    await writeFile(join(qrDir, 'NOT_QR.png'), 'png');
    await writeFile(join(qrDir, 'REG_OTHER.txt'), 'txt');
    const { service } = createService();

    const result = await service.previewStorageCleanup({
      scope: StorageCleanupScope.QR_ORPHANS,
    });

    expect(result.files).toEqual(['/uploads/qr/REG_ORPHAN.png']);
  });

  it('event file manifest includes QR, branding, and badge paths', async () => {
    const { service } = createService({
      event: {
        findUnique: jest.fn().mockResolvedValue({
          registrations: [{ publicId: 'REG_001' }, { publicId: 'REG_002' }],
          branding: {
            logoUrl: '/uploads/event-branding/logo.png',
            backgroundImageUrl: '/uploads/event-branding/bg.png',
            certificateImageUrl: '/uploads/event-branding/cert.png',
          },
          badgeTemplate: {
            backgroundImageUrl: '/uploads/badge-templates/badge.png',
          },
          digitalTicketTemplates: [
            {
              backgroundImageUrl:
                '/uploads/digital-tickets/templates/template.png',
              backgroundImagePath:
                '/uploads/digital-tickets/templates/template.png',
            },
          ],
          digitalTicketImages: [
            {
              relativePath: '/uploads/digital-tickets/generated/ticket.png',
            },
          ],
        }),
      },
    });

    await expect(service.findEventOwnedFiles('event-1')).resolves.toEqual([
      '/uploads/event-branding/logo.png',
      '/uploads/event-branding/bg.png',
      '/uploads/event-branding/cert.png',
      '/uploads/badge-templates/badge.png',
      '/uploads/digital-tickets/templates/template.png',
      '/uploads/digital-tickets/generated/ticket.png',
      '/uploads/qr/REG_001.png',
      '/uploads/qr/REG_002.png',
    ]);
  });
});

async function mkdirp(path: string) {
  await mkdir(path, { recursive: true });

  return path;
}
