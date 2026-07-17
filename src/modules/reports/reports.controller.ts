import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { MovementsByHourQueryDto } from './dto/movements-by-hour-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('events/:eventId/overview')
  overview(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    return this.reportsService.overview(user, eventId);
  }

  @Get('events/:eventId/registrations-by-type')
  registrationsByType(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
  ) {
    return this.reportsService.registrationsByType(user, eventId);
  }

  @Get('events/:eventId/movements-by-type')
  movementsByType(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
  ) {
    return this.reportsService.movementsByType(user, eventId);
  }

  @Get('events/:eventId/movements-by-hour')
  movementsByHour(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
    @Query() query: MovementsByHourQueryDto,
  ) {
    return this.reportsService.movementsByHour(user, eventId, query);
  }

  @Get('events/:eventId/checkpoints')
  checkpoints(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    return this.reportsService.checkpoints(user, eventId);
  }

  @Get('events/:eventId/staff-performance')
  staffPerformance(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
  ) {
    return this.reportsService.staffPerformance(user, eventId);
  }
}
