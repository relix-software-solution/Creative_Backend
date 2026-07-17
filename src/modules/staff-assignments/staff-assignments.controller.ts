import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CreateStaffAssignmentDto } from './dto/create-staff-assignment.dto';
import { ListStaffAssignmentsQueryDto } from './dto/list-staff-assignments-query.dto';
import { UpdateStaffAssignmentDto } from './dto/update-staff-assignment.dto';
import { StaffAssignmentsService } from './staff-assignments.service';

@Controller('staff-assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class StaffAssignmentsController {
  constructor(
    private readonly staffAssignmentsService: StaffAssignmentsService,
  ) {}

  @Post()
  create(@Body() createStaffAssignmentDto: CreateStaffAssignmentDto) {
    return this.staffAssignmentsService.create(createStaffAssignmentDto);
  }

  @Get()
  findAll(@Query() query: ListStaffAssignmentsQueryDto) {
    return this.staffAssignmentsService.findAll(query);
  }

  @Get('me')
  @Roles(UserRole.STAFF)
  findMyActive(@CurrentUser() currentUser: AuthUser) {
    return this.staffAssignmentsService.findMyActive(currentUser.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staffAssignmentsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateStaffAssignmentDto: UpdateStaffAssignmentDto,
  ) {
    return this.staffAssignmentsService.update(id, updateStaffAssignmentDto);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.staffAssignmentsService.deactivate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.staffAssignmentsService.remove(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.staffAssignmentsService.activate(id);
  }
}
