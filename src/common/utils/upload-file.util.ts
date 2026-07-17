import { Logger } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'path';

export type SafeDeleteUploadResult = {
  deleted: boolean;
  skipped: boolean;
  reason?: string;
};

export async function safeDeleteUploadFile(
  relativeUrl: string | null | undefined,
  uploadSubdir: string,
  logger: Logger,
): Promise<SafeDeleteUploadResult> {
  if (!relativeUrl) {
    return { deleted: false, skipped: true, reason: 'NO_FILE' };
  }

  const normalizedSubdir = uploadSubdir.replace(/\\/g, '/');
  const value = relativeUrl.trim().replace(/\\/g, '/');
  const expectedPrefix = `/uploads/${normalizedSubdir}/`;

  if (
    (isAbsolute(value) && !value.startsWith('/uploads/')) ||
    /^[A-Za-z]:\//.test(value) ||
    value.startsWith('//')
  ) {
    logger.warn('Skipped absolute upload delete path');

    return { deleted: false, skipped: true, reason: 'ABSOLUTE_PATH' };
  }

  if (!value.startsWith(expectedPrefix)) {
    logger.warn(
      `Skipped deleting upload outside ${expectedPrefix}: ${value}`,
    );

    return { deleted: false, skipped: true, reason: 'UNSUPPORTED_PATH' };
  }

  const parts = value.replace(/^\/+/, '').split('/');

  if (parts.some((part) => part === '..')) {
    logger.warn('Skipped upload delete path containing traversal');

    return { deleted: false, skipped: true, reason: 'UNSAFE_PATH' };
  }

  const uploadRoot = resolve(process.cwd(), 'uploads', uploadSubdir);
  const relativePath = value.replace(/^\/uploads\//, '');
  const filePath = resolve(process.cwd(), 'uploads', normalize(relativePath));
  const withinUploadRoot =
    filePath === uploadRoot || filePath.startsWith(`${uploadRoot}${sep}`);

  if (!withinUploadRoot) {
    logger.warn(`Skipped unsafe upload delete path: ${value}`);

    return { deleted: false, skipped: true, reason: 'UNSAFE_PATH' };
  }

  try {
    await unlink(filePath);

    return { deleted: true, skipped: false };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;

    if (code === 'ENOENT') {
      return { deleted: false, skipped: true, reason: 'NOT_FOUND' };
    }

    logger.warn(
      `Failed to delete upload file ${join('uploads', relativePath)}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );

    return { deleted: false, skipped: true, reason: 'DELETE_FAILED' };
  }
}
