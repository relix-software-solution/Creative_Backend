import {
  Body,
  Controller,
  Delete,
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
import { ListStaffSessionsQueryDto } from './dto/list-staff-sessions-query.dto';
import { StartStaffSessionDto } from './dto/start-staff-session.dto';
import { StaffSessionsService } from './staff-sessions.service';

@Controller('staff-sessions')
export class StaffSessionsController {
  constructor(private readonly staffSessionsService: StaffSessionsService) {}

  @Post('start')
  @UseGuards(JwtAuthGuard)
  start(
    @CurrentUser() currentUser: AuthUser,
    @Body() startStaffSessionDto: StartStaffSessionDto,
  ) {
    return this.staffSessionsService.start(currentUser, startStaffSessionDto);
  }

  @Post('start-my-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STAFF)
  startMySession(@CurrentUser() currentUser: AuthUser) {
    return this.staffSessionsService.startMySession(currentUser);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findAll(@Query() query: ListStaffSessionsQueryDto) {
    return this.staffSessionsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findOne(@Param('id') id: string) {
    return this.staffSessionsService.findOne(id);
  }

  @Post(':id/end')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  end(@Param('id') id: string) {
    return this.staffSessionsService.end(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.staffSessionsService.remove(id);
  }
}
