import {
  Body,
  Controller,
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
import { StaffAccessService } from '../staff-access/staff-access.service';
import { CreateScanDto } from './dto/create-scan.dto';
import { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import { ListRawScansQueryDto } from './dto/list-raw-scans-query.dto';
import { ScansService } from './scans.service';

@Controller()
export class ScansController {
  constructor(
    private readonly scansService: ScansService,
    private readonly staffAccessService: StaffAccessService,
  ) {}

  @Post('scans')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STAFF, UserRole.SUPER_ADMIN)
  async ingest(
    @CurrentUser() currentUser: AuthUser,
    @Body() createScanDto: CreateScanDto,
  ) {
    await this.staffAccessService.assertStaffCanScan(
      currentUser,
      createScanDto,
    );

    return this.scansService.ingest(createScanDto);
  }

  @Get('scans/raw')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findRawScans(@Query() query: ListRawScansQueryDto) {
    return this.scansService.findRawScans(query);
  }

  @Get('scans/raw/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findRawScan(@Param('id') id: string) {
    return this.scansService.findRawScan(id);
  }

  @Get('movements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findMovements(@Query() query: ListMovementsQueryDto) {
    return this.scansService.findMovements(query);
  }

  @Get('movements/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findMovement(@Param('id') id: string) {
    return this.scansService.findMovement(id);
  }
}
