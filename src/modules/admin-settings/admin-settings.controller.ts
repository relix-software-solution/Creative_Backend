import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminSettingsController {
  constructor(private readonly adminSettingsService: AdminSettingsService) {}

  @Get()
  getSettings() {
    return this.adminSettingsService.getSettings();
  }

  @Patch()
  updateSettings(@Body() dto: UpdateAdminSettingsDto) {
    return this.adminSettingsService.updateSettings(dto);
  }
}
