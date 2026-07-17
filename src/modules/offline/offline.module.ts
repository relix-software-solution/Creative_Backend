import { Module } from '@nestjs/common';
import { OfflineQrService } from './offline-qr.service';

@Module({
  providers: [OfflineQrService],
  exports: [OfflineQrService],
})
export class OfflineModule {}
