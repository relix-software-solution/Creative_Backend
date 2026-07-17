import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DigitalTicketsService } from './digital-tickets.service';
import { GenerateDigitalTicketDto } from './dto/generate-digital-ticket.dto';

@Controller('digital-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DigitalTicketsController {
  constructor(private readonly digitalTicketsService: DigitalTicketsService) {}

  @Post('registrations/:registrationId/generate')
  generate(
    @Param('registrationId') registrationId: string,
    @Body() dto: GenerateDigitalTicketDto,
  ) {
    return this.digitalTicketsService.generateForRegistration(
      registrationId,
      dto,
    );
  }

  @Post('registrations/:registrationId/regenerate')
  regenerate(
    @Param('registrationId') registrationId: string,
    @Body() dto: GenerateDigitalTicketDto,
  ) {
    return this.digitalTicketsService.generateForRegistration(registrationId, {
      ...dto,
      forceRegenerate: true,
    });
  }

  @Get('registrations/:registrationId')
  findLatest(@Param('registrationId') registrationId: string) {
    return this.digitalTicketsService.findLatestForRegistration(registrationId);
  }
}
