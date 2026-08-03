import {
  Body,
  Controller,
  Get,
  Header,
  Sse,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipResponseWrapper } from '../../common/decorators/skip-response-wrapper.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ListVisitorsQueryDto } from './dto/list-visitors-query.dto';
import { StaffOfflineSnapshotQueryDto } from './dto/staff-offline-snapshot-query.dto';
import { StaffVisitorChangesQueryDto } from './dto/staff-visitor-changes-query.dto';
import { UpdateStaffVisitorDto } from './dto/update-staff-visitor.dto';
import { VisitorRealtimeService } from './visitor-realtime.service';
import { VisitorsService } from './visitors.service';

@Controller('staff/visitors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF)
export class StaffVisitorsController {
  constructor(
    private readonly visitorsService: VisitorsService,
    private readonly visitorRealtimeService: VisitorRealtimeService,
  ) {}

  /**
   * تنزيل جميع زوار فعالية الموظف على دفعات مستقرة.
   *
   * GET /api/v1/staff/visitors/offline-snapshot
   * GET /api/v1/staff/visitors/offline-snapshot?cursor=...&limit=500
   */
  @Get('offline-snapshot')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getOfflineSnapshot(
    @CurrentUser() user: AuthUser,
    @Query() query: StaffOfflineSnapshotQueryDto,
    @Req() request: FastifyRequest,
  ) {
    return this.visitorsService.findOfflineSnapshotForStaff(
      user.id,
      query,
      this.getRequestBaseUrl(request),
    );
  }

  @Get('changes')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getChanges(
    @CurrentUser() user: AuthUser,
    @Query() query: StaffVisitorChangesQueryDto,
  ) {
    return this.visitorsService.findChangesForStaff(user.id, query);
  }

  /**
   * Authenticated Server-Sent Events stream. The frontend connects using
   * fetch() so the normal Bearer token remains in the Authorization header.
   */
  @Sse('realtime')
  @SkipResponseWrapper()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('X-Accel-Buffering', 'no')
  realtime(@CurrentUser() user: AuthUser) {
    return this.visitorRealtimeService.streamForStaff(user.id);
  }

  @Get('offline-state')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getOfflineState(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    return this.visitorsService.getOfflineStateForStaff(
      user.id,
      this.getRequestBaseUrl(request),
    );
  }

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

  @Post(':registrationId/qr')
  generateQr(
    @CurrentUser() user: AuthUser,
    @Param('registrationId') registrationId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.visitorsService.generateQrForStaff(
      user.id,
      registrationId,
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
