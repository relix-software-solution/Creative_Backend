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
import { CreateRegistrationFieldDto } from './dto/create-registration-field.dto';
import { ListRegistrationFieldsQueryDto } from './dto/list-registration-fields-query.dto';
import { UpdateRegistrationFieldDto } from './dto/update-registration-field.dto';
import { RegistrationFieldsService } from './registration-fields.service';

@Controller('registration-fields')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class RegistrationFieldsController {
  constructor(
    private readonly registrationFieldsService: RegistrationFieldsService,
  ) {}

  @Post()
  create(@Body() createRegistrationFieldDto: CreateRegistrationFieldDto) {
    return this.registrationFieldsService.create(createRegistrationFieldDto);
  }

  @Get()
  findAll(@Query() query: ListRegistrationFieldsQueryDto) {
    return this.registrationFieldsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.registrationFieldsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRegistrationFieldDto: UpdateRegistrationFieldDto,
  ) {
    return this.registrationFieldsService.update(
      id,
      updateRegistrationFieldDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.registrationFieldsService.remove(id);
  }
}
