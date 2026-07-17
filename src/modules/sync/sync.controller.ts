import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListSyncBatchesQueryDto } from './dto/list-sync-batches-query.dto';
import { SubmitSyncBatchDto } from './dto/submit-sync-batch.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('batches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STAFF, UserRole.SUPER_ADMIN)
  submitBatch(@Body() submitSyncBatchDto: SubmitSyncBatchDto) {
    return this.syncService.submitBatch(submitSyncBatchDto);
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
