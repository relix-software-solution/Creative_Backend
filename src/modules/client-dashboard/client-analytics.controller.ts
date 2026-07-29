import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ClientAnalyticsService } from './client-analytics.service';
import { ClientAnalyticsQueryDto } from './dto/client-analytics-query.dto';

@Controller('client/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT_VIEWER)
export class ClientAnalyticsController {
  constructor(
    private readonly clientAnalyticsService: ClientAnalyticsService,
  ) {}

  @Get()
  getAnalytics(
    @CurrentUser() user: AuthUser,
    @Query()
    query: ClientAnalyticsQueryDto,
  ) {
    return this.clientAnalyticsService.getAnalytics(user, query);
  }
}
