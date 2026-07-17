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
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AttendeeTypesService } from './attendee-types.service';
import { CreateAttendeeTypeDto } from './dto/create-attendee-type.dto';
import { ListAttendeeTypesQueryDto } from './dto/list-attendee-types-query.dto';
import { UpdateAttendeeTypeDto } from './dto/update-attendee-type.dto';

@Controller('attendee-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AttendeeTypesController {
  constructor(private readonly attendeeTypesService: AttendeeTypesService) {}

  @Post()
  create(@Body() createAttendeeTypeDto: CreateAttendeeTypeDto) {
    return this.attendeeTypesService.create(createAttendeeTypeDto);
  }

  @Get()
  findAll(@Query() query: ListAttendeeTypesQueryDto) {
    return this.attendeeTypesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.attendeeTypesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAttendeeTypeDto: UpdateAttendeeTypeDto,
  ) {
    return this.attendeeTypesService.update(id, updateAttendeeTypeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.attendeeTypesService.remove(id);
  }
}
