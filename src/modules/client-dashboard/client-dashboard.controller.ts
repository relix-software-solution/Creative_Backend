import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ClientDashboardService } from './client-dashboard.service';

@Controller('client/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT_VIEWER)
export class ClientDashboardController {
  constructor(
    private readonly clientDashboardService: ClientDashboardService,
  ) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.clientDashboardService.summary(user);
  }
}
