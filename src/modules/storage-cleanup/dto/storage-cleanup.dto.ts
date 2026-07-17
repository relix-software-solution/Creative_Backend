import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum StorageCleanupScope {
  QR_ORPHANS = 'QR_ORPHANS',
  QR_OLD = 'QR_OLD',
  ALL_SAFE_ORPHANS = 'ALL_SAFE_ORPHANS',
}

export class StorageCleanupRequestDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = true;

  @IsEnum(StorageCleanupScope)
  scope: StorageCleanupScope;

  @IsOptional()
  @IsInt()
  @Min(1)
  olderThanDays?: number;
}

export class EventCleanupFilesRequestDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = true;
}
