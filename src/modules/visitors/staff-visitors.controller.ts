import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ListVisitorsQueryDto } from './dto/list-visitors-query.dto';
import { UpdateStaffVisitorDto } from './dto/update-staff-visitor.dto';
import { VisitorsService } from './visitors.service';

@Controller('staff/visitors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF)
export class StaffVisitorsController {
  constructor(private readonly visitorsService: VisitorsService) {}

  @Get()
  findMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListVisitorsQueryDto,
    @Req() request: FastifyRequest,
  ) {
    return this.visitorsService.findForStaff(
      user.id,
      query,
      this.getRequestBaseUrl(request),
    );
  }

  @Patch(':registrationId')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('registrationId') registrationId: string,
    @Body() dto: UpdateStaffVisitorDto,
  ) {
    return this.visitorsService.updateForStaff(user.id, registrationId, dto);
  }

  private getRequestBaseUrl(request: FastifyRequest) {
    const protocol =
      request.headers['x-forwarded-proto'] ??
      (request as FastifyRequest & { protocol?: string }).protocol ??
      'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host;

    return host ? `${protocol}://${host}` : undefined;
  }
}
