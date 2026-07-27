import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ProvisionOfflineKeyDto } from '../devices/dto/provision-offline-key.dto';
import { StaffOfflineService } from './staff-offline.service';

@Controller('staff/offline')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF)
export class StaffOfflineController {
  constructor(private readonly staffOfflineService: StaffOfflineService) {}

  @Post('key')
  provisionKey(
    @CurrentUser() currentUser: AuthUser,
    @Body() dto: ProvisionOfflineKeyDto,
  ) {
    return this.staffOfflineService.provisionMyAssignedDeviceKey(
      currentUser,
      dto,
      false,
    );
  }

  @Post('key/rotate')
  rotateKey(
    @CurrentUser() currentUser: AuthUser,
    @Body() dto: ProvisionOfflineKeyDto,
  ) {
    return this.staffOfflineService.provisionMyAssignedDeviceKey(
      currentUser,
      dto,
      true,
    );
  }
}
