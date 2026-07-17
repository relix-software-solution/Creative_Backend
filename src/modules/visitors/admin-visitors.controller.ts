import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListAdminVisitorsQueryDto } from './dto/list-visitors-query.dto';
import { VisitorsService } from './visitors.service';

@Controller('admin/visitors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminVisitorsController {
  constructor(private readonly visitorsService: VisitorsService) {}

  @Get()
  findAll(@Query() query: ListAdminVisitorsQueryDto) {
    return this.visitorsService.findForAdmin(query);
  }
}
