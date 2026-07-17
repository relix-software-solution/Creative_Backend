import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DigitalTicketsService } from '../../digital-tickets/digital-tickets.service';
import { QUEUE_NAMES } from '../queue.constants';

export type DigitalTicketGenerationJob = {
  registrationId: string;
  eventId: string;
  forceRegenerate?: boolean;
};

@Processor(QUEUE_NAMES.DIGITAL_TICKET_GENERATION)
export class DigitalTicketGenerationProcessor extends WorkerHost {
  constructor(
    private readonly digitalTicketsService: DigitalTicketsService,
  ) {
    super();
  }

  async process(job: Job<DigitalTicketGenerationJob>) {
    await job.updateProgress(10);
    const image = await this.digitalTicketsService.generateForRegistration(
      job.data.registrationId,
      { forceRegenerate: job.data.forceRegenerate },
    );
    await job.updateProgress(100);

    return {
      registrationId: job.data.registrationId,
      eventId: job.data.eventId,
      digitalTicketImageId: image.id,
      imageUrl: image.imageUrl,
      whatsappQueued: false,
    };
  }
}
