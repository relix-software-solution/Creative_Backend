import { Module } from '@nestjs/common';
import { QrModule } from '../qr/qr.module';
import { BadgeTemplatesController } from './badge-templates.controller';
import { BadgeTemplatesService } from './badge-templates.service';

@Module({
  imports: [QrModule],
  controllers: [BadgeTemplatesController],
  providers: [BadgeTemplatesService],
  exports: [BadgeTemplatesService],
})
export class BadgeTemplatesModule {}
