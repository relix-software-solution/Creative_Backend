import {
  Controller,
  Get,
  Param,
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
import type { AuthUser } from '../auth/types/auth-user.type';
import { ClientRegistrationsService } from './client-registrations.service';
import { ClientRegistrationsQueryDto } from './dto/client-registrations-query.dto';
import { ClientRegistrationExportService } from './export/client-registration-export.service';

@Controller('client/registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT_VIEWER)
export class ClientRegistrationsController {
  constructor(
    private readonly clientRegistrationsService: ClientRegistrationsService,

    private readonly clientRegistrationExportService: ClientRegistrationExportService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query()
    query: ClientRegistrationsQueryDto,
  ) {
    return this.clientRegistrationsService.findAll(user, query);
  }

  /**
   * يجب أن يكون قبل :registrationId
   * حتى لا تعتبر كلمة export معرّف تسجيل.
   */
  @Get('export')
  async exportRegistrations(
    @CurrentUser() user: AuthUser,

    @Query()
    query: ClientRegistrationsQueryDto,

    @Req()
    request: FastifyRequest,

    @Res()
    reply: FastifyReply,
  ): Promise<void> {
    const userAgentHeader = request.headers['user-agent'];

    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(', ')
      : userAgentHeader;

    const result =
      await this.clientRegistrationExportService.exportRegistrations(
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

  @Get(':registrationId')
  findOne(
    @CurrentUser() user: AuthUser,

    @Param('registrationId')
    registrationId: string,
  ) {
    return this.clientRegistrationsService.findOne(user, registrationId);
  }
}
