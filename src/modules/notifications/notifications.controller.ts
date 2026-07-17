import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BulkRetryFailedNotificationsDto } from './dto/bulk-retry-failed-notifications.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { FailedSummaryQueryDto } from './dto/failed-summary-query.dto';
import { ListNotificationLogsQueryDto } from './dto/list-notification-logs-query.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { SendRegistrationQrDto } from './dto/send-registration-qr.dto';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('templates')
  createTemplate(@Body() dto: CreateNotificationTemplateDto) {
    return this.notificationsService.createTemplate(dto);
  }

  @Get('templates')
  findTemplates(@Query() query: ListTemplatesQueryDto) {
    return this.notificationsService.findTemplates(query);
  }

  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.notificationsService.findTemplate(id);
  }

  @Patch('templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ) {
    return this.notificationsService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  removeTemplate(@Param('id') id: string) {
    return this.notificationsService.removeTemplate(id);
  }

  @Post('send-registration-qr')
  sendRegistrationQr(@Body() dto: SendRegistrationQrDto) {
    return this.notificationsService.sendRegistrationQr(dto);
  }

  @Get('failed-summary')
  failedSummary(@Query() query: FailedSummaryQueryDto) {
    return this.notificationsService.failedSummary(query);
  }

  @Post('logs/:id/retry')
  retryLog(@Param('id') id: string) {
    return this.notificationsService.retryLog(id);
  }

  @Post('retry-failed')
  retryFailed(@Body() dto: BulkRetryFailedNotificationsDto) {
    return this.notificationsService.retryFailed(dto);
  }

  @Get('logs')
  findLogs(@Query() query: ListNotificationLogsQueryDto) {
    return this.notificationsService.findLogs(query);
  }

  @Get('logs/:id')
  findLog(@Param('id') id: string) {
    return this.notificationsService.findLog(id);
  }
}
