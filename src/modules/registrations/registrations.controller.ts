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
import { DigitalTicketStatusService } from '../digital-tickets/digital-ticket-status.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import { RegistrationsService } from './registrations.service';

@Controller('registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class RegistrationsController {
  constructor(
    private readonly digitalTicketStatusService: DigitalTicketStatusService,
    private readonly registrationsService: RegistrationsService,
  ) {}

  @Post()
  async create(@Body() createRegistrationDto: CreateRegistrationDto) {
    const registration =
      await this.registrationsService.create(createRegistrationDto);
    const digitalTicket =
      await this.digitalTicketStatusService.resolveForRegistration({
        registration,
        includePollUrl: false,
      });

    return {
      registration,
      digitalTicket,
    };
  }

  @Get()
  findAll(@Query() query: ListRegistrationsQueryDto) {
    return this.registrationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.registrationsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRegistrationDto: UpdateRegistrationDto,
  ) {
    return this.registrationsService.update(id, updateRegistrationDto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.registrationsService.cancel(id);
  }

  @Post(':id/block')
  block(@Param('id') id: string) {
    return this.registrationsService.block(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.registrationsService.activate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.registrationsService.remove(id);
  }
}
