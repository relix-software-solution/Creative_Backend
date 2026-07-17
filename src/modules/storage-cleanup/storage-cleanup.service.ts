import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { AuditAction, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { access, readdir, stat, unlink } from 'fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { StorageCleanupScope } from './dto/storage-cleanup.dto';

export const STORAGE_CLEANUP_JOB_NAMES = {
  EVENT_CLEANUP_FILES: 'event.cleanup-files',
  STORAGE_CLEANUP_ORPHANS: 'storage.cleanup-orphans',
  REGISTRATION_CLEANUP_QR: 'registration.cleanup-qr',
} as const;

export type StorageCleanupSummary = {
  scannedFiles: number;
  deletedFiles: number;
  freedBytes: number;
  missingFiles: number;
  errors: string[];
};

export type StorageCleanupCandidateSummary = {
  dryRun: true;
  scope?: StorageCleanupScope;
  scannedFiles: number;
  candidateFiles: number;
  candidateBytes: number;
  errors: string[];
  files: string[];
};

export type StorageCleanupJobData = {
  relativePaths: string[];
  requestedByUserId?: string;
  eventId?: string;
  scope?: StorageCleanupScope;
};

type StorageFile = {
  relativePath: string;
  size: number;
  mtime: Date;
};

const APPROVED_UPLOAD_DIRS = [
  'qr',
  'event-branding',
  'badge-templates',
  'certificates',
  'digital-tickets',
] as const;

const QR_FILENAME_PATTERN = /^REG_[A-Za-z0-9_-]+\.png$/;

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.EVENT_STORAGE_CLEANUP)
    private readonly cleanupQueue: Queue<StorageCleanupJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueEventCleanup(input: {
    eventId: string;
    relativePaths: string[];
    requestedByUserId?: string;
  }) {
    const relativePaths = this.uniqueSafeRelativePaths(input.relativePaths);

    if (!this.cleanupEnabled) {
      const result = await this.safeDeleteMany(relativePaths);

      return {
        queued: false,
        reason: 'STORAGE_CLEANUP_DISABLED',
        result,
      };
    }

    let job;

    try {
      job = await this.cleanupQueue.add(
        STORAGE_CLEANUP_JOB_NAMES.EVENT_CLEANUP_FILES,
        {
          eventId: input.eventId,
          relativePaths,
          requestedByUserId: input.requestedByUserId,
        },
        this.defaultJobOptions,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue event storage cleanup for event ${input.eventId}; running synchronous fallback: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      const result = await this.safeDeleteMany(relativePaths);

      return {
        queued: false,
        reason: 'QUEUE_ENQUEUE_FAILED',
        result,
      };
    }

    this.logger.log(
      `Queued event storage cleanup for event ${input.eventId}: job=${job.id} files=${relativePaths.length}`,
    );

    return { queued: true, jobId: String(job.id) };
  }

  async enqueueRegistrationQrCleanup(input: {
    registrationPublicId: string;
    requestedByUserId?: string;
  }) {
    const relativePath = this.qrImageRelativePath(input.registrationPublicId);

    if (!this.cleanupEnabled) {
      const result = await this.safeDeleteMany([relativePath]);

      return {
        queued: false,
        reason: 'STORAGE_CLEANUP_DISABLED',
        result,
      };
    }

    const job = await this.cleanupQueue.add(
      STORAGE_CLEANUP_JOB_NAMES.REGISTRATION_CLEANUP_QR,
      {
        relativePaths: [relativePath],
        requestedByUserId: input.requestedByUserId,
      },
      this.defaultJobOptions,
    );

    return { queued: true, jobId: String(job.id) };
  }

  async enqueueStorageCleanup(input: {
    scope: StorageCleanupScope;
    olderThanDays?: number;
    requestedByUserId?: string;
  }) {
    const preview = await this.previewStorageCleanup(input);

    if (!this.cleanupEnabled) {
      const result = await this.safeDeleteMany(preview.files);

      return {
        queued: false,
        reason: 'STORAGE_CLEANUP_DISABLED',
        result,
      };
    }

    const job = await this.cleanupQueue.add(
      STORAGE_CLEANUP_JOB_NAMES.STORAGE_CLEANUP_ORPHANS,
      {
        relativePaths: preview.files,
        requestedByUserId: input.requestedByUserId,
        scope: input.scope,
      },
      this.defaultJobOptions,
    );

    await this.auditCleanupRequest({
      actorUserId: input.requestedByUserId,
      scope: input.scope,
      dryRun: false,
      jobId: String(job.id),
      counts: preview,
    });

    return {
      queued: true,
      jobId: String(job.id),
      candidateFiles: preview.candidateFiles,
    };
  }

  async previewStorageCleanup(input: {
    scope: StorageCleanupScope;
    olderThanDays?: number;
    requestedByUserId?: string;
  }): Promise<StorageCleanupCandidateSummary> {
    const olderThanDays =
      input.olderThanDays ??
      this.configService.get<number>('QR_IMAGE_RETENTION_DAYS', 30);
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const qrFiles = await this.scanQrFiles();
    let candidates: StorageFile[] = [];

    if (
      input.scope === StorageCleanupScope.QR_ORPHANS ||
      input.scope === StorageCleanupScope.ALL_SAFE_ORPHANS
    ) {
      candidates = await this.findOrphanQrFiles(qrFiles);
    } else if (input.scope === StorageCleanupScope.QR_OLD) {
      const existing = await this.findExistingQrFiles(qrFiles);
      candidates = existing.filter((file) => file.mtime < cutoff);
    }

    const result = this.toCandidateSummary(
      input.scope,
      qrFiles.length,
      candidates,
    );

    await this.auditCleanupRequest({
      actorUserId: input.requestedByUserId,
      scope: input.scope,
      dryRun: true,
      counts: result,
    });

    return result;
  }

  async previewEventCleanup(
    eventId: string,
  ): Promise<StorageCleanupCandidateSummary> {
    const relativePaths = await this.findEventOwnedFiles(eventId);
    const files = await this.statExistingRelativePaths(relativePaths);

    return this.toCandidateSummary(undefined, relativePaths.length, files);
  }

  async getCleanupJob(jobId: string) {
    const job = await this.cleanupQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException('Storage cleanup job not found');
    }

    return {
      jobId: String(job.id),
      state: await job.getState(),
      progress: job.progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  async runCleanupJob(data: StorageCleanupJobData) {
    const summary = await this.safeDeleteMany(data.relativePaths);

    await this.auditCleanupRequest({
      actorUserId: data.requestedByUserId,
      scope: data.scope,
      dryRun: false,
      eventId: data.eventId,
      counts: summary,
    });

    return summary;
  }

  async safeDeleteMany(relativePaths: string[]) {
    const summary = this.emptySummary();
    const uniquePaths = this.uniqueSafeRelativePaths(relativePaths);

    for (const relativePath of uniquePaths) {
      const result = await this.safeDeleteRelativePath(relativePath);
      summary.scannedFiles += 1;
      summary.deletedFiles += result.deleted ? 1 : 0;
      summary.freedBytes += result.freedBytes;
      summary.missingFiles += result.missing ? 1 : 0;

      if (result.error) {
        summary.errors.push(result.error);
      }
    }

    return summary;
  }

  async safeDeleteRelativePath(relativePath: string) {
    const safePath = this.toSafeRelativePath(relativePath);
    const target = this.resolveSafePath(safePath);

    try {
      const fileStat = await stat(target.absolutePath);
      await unlink(target.absolutePath);

      return {
        relativePath: safePath,
        deleted: true,
        missing: false,
        freedBytes: fileStat.size,
      };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined;

      if (code === 'ENOENT') {
        return {
          relativePath: safePath,
          deleted: false,
          missing: true,
          freedBytes: 0,
        };
      }

      this.logger.warn(
        `Failed to delete upload file ${safePath}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return {
        relativePath: safePath,
        deleted: false,
        missing: false,
        freedBytes: 0,
        error: `DELETE_FAILED:${safePath}`,
      };
    }
  }

  async scanQrFiles(): Promise<StorageFile[]> {
    const qrRoot = this.resolveApprovedRoot('qr');

    try {
      await access(qrRoot);
    } catch {
      return [];
    }

    const entries = await readdir(qrRoot, { withFileTypes: true });
    const files: StorageFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !QR_FILENAME_PATTERN.test(entry.name)) {
        continue;
      }

      const absolutePath = join(qrRoot, entry.name);
      const fileStat = await stat(absolutePath);

      files.push({
        relativePath: `/uploads/qr/${entry.name}`,
        size: fileStat.size,
        mtime: fileStat.mtime,
      });
    }

    return files;
  }

  async findOrphanQrFiles(files?: StorageFile[]) {
    const qrFiles = files ?? (await this.scanQrFiles());
    const existing = await this.findExistingQrFiles(qrFiles);
    const existingPaths = new Set(existing.map((file) => file.relativePath));

    return qrFiles.filter((file) => !existingPaths.has(file.relativePath));
  }

  async findEventOwnedFiles(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        registrations: { select: { publicId: true } },
        branding: {
          select: {
            logoUrl: true,
            backgroundImageUrl: true,
            certificateImageUrl: true,
          },
        },
        badgeTemplate: { select: { backgroundImageUrl: true } },
        digitalTicketTemplates: {
          select: {
            backgroundImageUrl: true,
            backgroundImagePath: true,
          },
        },
        digitalTicketImages: { select: { relativePath: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return this.uniqueSafeRelativePaths([
      event.branding?.logoUrl,
      event.branding?.backgroundImageUrl,
      event.branding?.certificateImageUrl,
      event.badgeTemplate?.backgroundImageUrl,
      ...(event.digitalTicketTemplates ?? []).flatMap((template) => [
        template.backgroundImageUrl,
        template.backgroundImagePath,
      ]),
      ...(event.digitalTicketImages ?? []).map((image) => image.relativePath),
      ...event.registrations.map((registration) =>
        this.qrImageRelativePath(registration.publicId),
      ),
    ]);
  }

  qrImageRelativePath(registrationPublicId: string) {
    return `/uploads/qr/${this.sanitizeFilename(registrationPublicId)}.png`;
  }

  private async findExistingQrFiles(files: StorageFile[]) {
    if (files.length === 0) {
      return [];
    }

    const publicIds = files.map((file) =>
      file.relativePath.replace(/^\/uploads\/qr\//, '').replace(/\.png$/, ''),
    );
    const registrations = await this.prisma.registration.findMany({
      where: { publicId: { in: publicIds } },
      select: { publicId: true },
    });
    const existingPublicIds = new Set(
      registrations.map((registration) => registration.publicId),
    );

    return files.filter((file) =>
      existingPublicIds.has(
        file.relativePath.replace(/^\/uploads\/qr\//, '').replace(/\.png$/, ''),
      ),
    );
  }

  private async statExistingRelativePaths(relativePaths: string[]) {
    const files: StorageFile[] = [];

    for (const relativePath of relativePaths) {
      try {
        const target = this.resolveSafePath(relativePath);
        const fileStat = await stat(target.absolutePath);

        files.push({
          relativePath,
          size: fileStat.size,
          mtime: fileStat.mtime,
        });
      } catch {
        continue;
      }
    }

    return files;
  }

  private toCandidateSummary(
    scope: StorageCleanupScope | undefined,
    scannedFiles: number,
    files: StorageFile[],
  ): StorageCleanupCandidateSummary {
    return {
      dryRun: true,
      ...(scope ? { scope } : {}),
      scannedFiles,
      candidateFiles: files.length,
      candidateBytes: files.reduce((sum, file) => sum + file.size, 0),
      errors: [],
      files: files.map((file) => file.relativePath),
    };
  }

  private uniqueSafeRelativePaths(
    relativePaths: Array<string | null | undefined>,
  ) {
    return Array.from(
      new Set(
        relativePaths
          .filter((path): path is string => typeof path === 'string')
          .map((path) => this.toSafeRelativePath(path)),
      ),
    );
  }

  private toSafeRelativePath(input: string) {
    const value = input.trim().replace(/\\/g, '/');

    if (!value) {
      throw new BadRequestException('Upload path is required');
    }

    if (
      isAbsolute(value) &&
      !value.startsWith('/uploads/') &&
      !value.startsWith('uploads/')
    ) {
      throw new BadRequestException(
        'Absolute filesystem paths are not allowed',
      );
    }

    if (/^[A-Za-z]:\//.test(value) || value.startsWith('//')) {
      throw new BadRequestException(
        'Absolute filesystem paths are not allowed',
      );
    }

    const withoutLeadingSlash = value.replace(/^\/+/, '');
    const rawParts = withoutLeadingSlash.split('/');

    if (rawParts.some((part) => part === '..')) {
      throw new BadRequestException('Unsafe upload path');
    }

    const normalized = normalize(withoutLeadingSlash).replace(/\\/g, '/');
    const parts = normalized.split('/');

    if (
      parts.length < 3 ||
      parts[0] !== 'uploads' ||
      parts.some((part) => part === '..')
    ) {
      throw new BadRequestException('Unsafe upload path');
    }

    if (!APPROVED_UPLOAD_DIRS.includes(parts[1] as never)) {
      throw new BadRequestException('Upload directory is not approved');
    }

    return `/${normalized}`;
  }

  private resolveSafePath(relativePath: string) {
    const safePath = this.toSafeRelativePath(relativePath);
    const [, , subdir] = safePath.split('/');
    const root = this.resolveApprovedRoot(subdir);
    const relativeWithinUploads = safePath.replace(/^\/uploads\//, '');
    const absolutePath = resolve(this.uploadRoot, relativeWithinUploads);
    const withinRoot =
      absolutePath === root || absolutePath.startsWith(`${root}${sep}`);

    if (!withinRoot) {
      throw new BadRequestException('Resolved upload path is unsafe');
    }

    return { absolutePath, safePath };
  }

  private resolveApprovedRoot(subdir: string) {
    const root = resolve(this.uploadRoot, subdir);
    const uploadsRoot = resolve(this.uploadRoot);
    const withinUploads =
      root === uploadsRoot || root.startsWith(`${uploadsRoot}${sep}`);

    if (!withinUploads) {
      throw new BadRequestException('Approved upload root is unsafe');
    }

    return root;
  }

  private sanitizeFilename(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private async auditCleanupRequest(input: {
    actorUserId?: string;
    eventId?: string;
    scope?: StorageCleanupScope;
    dryRun: boolean;
    jobId?: string;
    counts: Record<string, unknown>;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          eventId: input.eventId,
          actorUserId: input.actorUserId,
          action: AuditAction.DELETE,
          entityType: input.eventId ? 'EVENT_STORAGE' : 'STORAGE',
          entityId: input.eventId ?? input.jobId,
          metadata: {
            source: 'STORAGE_CLEANUP',
            scope: input.scope,
            dryRun: input.dryRun,
            jobId: input.jobId,
            counts: input.counts,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not write storage cleanup audit log: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private emptySummary(): StorageCleanupSummary {
    return {
      scannedFiles: 0,
      deletedFiles: 0,
      freedBytes: 0,
      missingFiles: 0,
      errors: [],
    };
  }

  private get defaultJobOptions() {
    return {
      attempts: this.configService.get<number>(
        'STORAGE_CLEANUP_MAX_ATTEMPTS',
        5,
      ),
      backoff: {
        type: 'exponential',
        delay: this.configService.get<number>(
          'STORAGE_CLEANUP_RETRY_BACKOFF_MS',
          5000,
        ),
      },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    };
  }

  private get cleanupEnabled() {
    return this.configService.get<boolean>('STORAGE_CLEANUP_ENABLED', true);
  }

  private get uploadRoot() {
    return (
      this.configService.get<string>('STORAGE_UPLOAD_ROOT') ??
      join(process.cwd(), 'uploads')
    );
  }
}
