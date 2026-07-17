import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { QrImageService } from './qr-image.service';
import { QrService } from './qr.service';
import { ValidateQrDto } from './dto/validate-qr.dto';

@Controller('qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class QrController {
  constructor(
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
  ) {}

  @Post('registrations/:registrationId/generate')
  generate(@Param('registrationId') registrationId: string) {
    return this.qrService.generate(registrationId);
  }

  @Get('registrations/:registrationId')
  findByRegistration(@Param('registrationId') registrationId: string) {
    return this.qrService.findByRegistration(registrationId);
  }

  @Post('validate')
  validate(@Body() validateQrDto: ValidateQrDto) {
    return this.qrService.validate(validateQrDto.qrToken);
  }

  @Post('registrations/:registrationId/revoke')
  revoke(@Param('registrationId') registrationId: string) {
    return this.qrService.revoke(registrationId);
  }

  @Post('registrations/:registrationId/image')
  async generateImage(
    @Param('registrationId') registrationId: string,
    @Req() request: FastifyRequest,
  ) {
    const qr = await this.qrService.generate(registrationId);
    const image = await this.qrImageService.generateRegistrationQrImage({
      registrationPublicId: qr.payload.registrationPublicId,
      qrToken: qr.qrToken,
      requestBaseUrl: this.getRequestBaseUrl(request),
    });

    return {
      registrationId,
      qrToken: qr.qrToken,
      imageUrl: image.publicUrl,
      relativePath: image.relativePath,
    };
  }

  @Get('registrations/:registrationId/image')
  async findOrGenerateImage(
    @Param('registrationId') registrationId: string,
    @Req() request: FastifyRequest,
  ) {
    const qr = await this.qrService.generate(registrationId);
    const existingImage =
      await this.qrImageService.getRegistrationQrImageMetadata({
        registrationPublicId: qr.payload.registrationPublicId,
        requestBaseUrl: this.getRequestBaseUrl(request),
      });
    const image =
      existingImage ??
      (await this.qrImageService.generateRegistrationQrImage({
        registrationPublicId: qr.payload.registrationPublicId,
        qrToken: qr.qrToken,
        requestBaseUrl: this.getRequestBaseUrl(request),
      }));

    return {
      registrationId,
      qrToken: qr.qrToken,
      imageUrl: image.publicUrl,
      relativePath: image.relativePath,
    };
  }

  private getRequestBaseUrl(request: FastifyRequest) {
    const protocol =
      request.headers['x-forwarded-proto'] ??
      (request as FastifyRequest & { protocol?: string }).protocol ??
      'http';
    const host = request.headers['x-forwarded-host'] ?? request.headers.host;

    return host ? `${protocol}://${host}` : undefined;
  }
}
