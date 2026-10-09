import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VisitorScanTrackingQueryDto } from './dto/visitor-scan-tracking-query.dto';
import { ScanTrackingService } from './scan-tracking.service';

@Controller('scan-tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ScanTrackingController {
  constructor(private readonly scanTrackingService: ScanTrackingService) {}

  @Get('filters')
  getFilters() {
    return this.scanTrackingService.getFilters();
  }

  @Get('visitors')
  listVisitors(@Query() query: VisitorScanTrackingQueryDto) {
    return this.scanTrackingService.listVisitors(query);
  }

  @Get('visitors/export')
  async exportVisitors(
    @Query() query: VisitorScanTrackingQueryDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.scanTrackingService.exportVisitors(query);

    reply
      .code(200)
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .header('Content-Length', String(result.buffer.length))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(result.buffer);
  }

  @Get('visitors/:registrationId')
  getVisitor(
    @Param('registrationId') registrationId: string,
    @Query() query: VisitorScanTrackingQueryDto,
  ) {
    return this.scanTrackingService.getVisitor(registrationId, query);
  }
}
