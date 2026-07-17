import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrImageService } from './qr-image.service';
import { QrService } from './qr.service';

@Module({
  controllers: [QrController],
  providers: [QrService, QrImageService],
  exports: [QrService, QrImageService],
})
export class QrModule {}
