import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { StorageCleanupRequestDto } from './dto/storage-cleanup.dto';
import { StorageCleanupService } from './storage-cleanup.service';

@Controller('admin/storage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class StorageCleanupController {
  constructor(private readonly storageCleanupService: StorageCleanupService) {}

  @Post('cleanup')
  cleanup(
    @Body() dto: StorageCleanupRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (dto.dryRun !== false) {
      return this.storageCleanupService.previewStorageCleanup({
        scope: dto.scope,
        olderThanDays: dto.olderThanDays,
        requestedByUserId: user.id,
      });
    }

    return this.storageCleanupService.enqueueStorageCleanup({
      scope: dto.scope,
      olderThanDays: dto.olderThanDays,
      requestedByUserId: user.id,
    });
  }

  @Get('cleanup/:jobId')
  getCleanupJob(@Param('jobId') jobId: string) {
    return this.storageCleanupService.getCleanupJob(jobId);
  }
}
