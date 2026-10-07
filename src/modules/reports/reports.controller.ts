import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { MovementsByHourQueryDto } from './dto/movements-by-hour-query.dto';
import { ReportExportQueryDto } from './dto/report-export-query.dto';
import { ReportsExcelService } from './reports-excel.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsExcelService: ReportsExcelService,
  ) {}

  @Get('events/:eventId/overview')
  overview(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    return this.reportsService.overview(user, eventId);
  }

  @Get('events/:eventId/export')
  async exportEventReport(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
    @Query() query: ReportExportQueryDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.reportsExcelService.exportEventReport(
      user,
      eventId,
      query,
    );

    reply
      .code(200)
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .header('Content-Length', String(result.buffer.length))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(result.buffer);
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
