import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { QrModule } from '../qr/qr.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { DigitalTicketsController } from './digital-tickets.controller';
import { DigitalTicketStatusService } from './digital-ticket-status.service';
import { DigitalTicketsService } from './digital-tickets.service';
import { DigitalTicketImageService } from './image/digital-ticket-image.service';
import { FontService } from './renderer/font.service';
import { SvgBuilderService } from './renderer/svg-builder.service';
import { TicketRendererService } from './renderer/ticket-renderer.service';

@Module({
  imports: [
    BadgeTemplatesModule,
    QrModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.REGISTRATION_PIPELINE,
    }),
  ],
  controllers: [DigitalTicketsController],
  providers: [
    DigitalTicketStatusService,
    DigitalTicketsService,
    DigitalTicketImageService,
    FontService,
    SvgBuilderService,
    TicketRendererService,
  ],
  exports: [DigitalTicketStatusService, DigitalTicketsService],
})
export class DigitalTicketsModule {}
