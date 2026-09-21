import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DigitalTicketStatusService } from '../digital-tickets/digital-ticket-status.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import type { AuthUser } from '../auth/types/auth-user.type';
import { AdminRegistrationExportService } from './export/admin-registration-export.service';
import { RegistrationsService } from './registrations.service';

@Controller('registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class RegistrationsController {
  constructor(
    private readonly digitalTicketStatusService: DigitalTicketStatusService,
    private readonly registrationsService: RegistrationsService,
    private readonly adminRegistrationExportService: AdminRegistrationExportService,
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

  /**
   * يجب أن يكون قبل :id حتى لا تعتبر كلمة export معرّف تسجيل.
   */
  @Get('export')
  async exportRegistrations(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRegistrationsQueryDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const userAgentHeader = request.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(', ')
      : userAgentHeader;

    const result = await this.adminRegistrationExportService.exportRegistrations(
      user,
      query,
      {
        ipAddress: request.ip,
        userAgent,
      },
    );

    if (!result) {
      reply.code(204).send();
      return;
    }

    reply
      .code(200)
      .header('Content-Type', result.contentType)
      .header(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      )
      .header('Content-Length', String(result.buffer.length))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(result.buffer);
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
