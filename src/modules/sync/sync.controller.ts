import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { StaffAccessService } from '../staff-access/staff-access.service';
import { ListSyncBatchesQueryDto } from './dto/list-sync-batches-query.dto';
import { RecoverOfflineRegistrationsDto } from './dto/recover-offline-registrations.dto';
import { SubmitSyncBatchDto } from './dto/submit-sync-batch.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly staffAccessService: StaffAccessService,
  ) {}

  @Post('batches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STAFF, UserRole.SUPER_ADMIN)
  async submitBatch(
    @CurrentUser() currentUser: AuthUser,
    @Body() submitSyncBatchDto: SubmitSyncBatchDto,
  ) {
    await this.staffAccessService.assertStaffCanSubmitSyncBatch(
      currentUser,
      submitSyncBatchDto,
    );

    return this.syncService.submitBatch(submitSyncBatchDto);
  }

  @Post('recovery/offline-registrations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  recoverOfflineRegistrations(@Body() dto: RecoverOfflineRegistrationsDto) {
    return this.syncService.recoverFailedOfflineRegistrations(dto);
  }

  @Get('batches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findAll(@Query() query: ListSyncBatchesQueryDto) {
    return this.syncService.findAll(query);
  }

  @Get('batches/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findOne(@Param('id') id: string) {
    return this.syncService.findOne(id);
  }
}
