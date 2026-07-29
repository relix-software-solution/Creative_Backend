import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ClientEventsService } from './client-events.service';
import { ClientEventsQueryDto } from './dto/client-events-query.dto';

@Controller('client/events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT_VIEWER)
export class ClientEventsController {
  constructor(private readonly clientEventsService: ClientEventsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ClientEventsQueryDto) {
    return this.clientEventsService.findAll(user, query);
  }

  @Get(':eventId')
  findOne(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    return this.clientEventsService.findOne(user, eventId);
  }
}
