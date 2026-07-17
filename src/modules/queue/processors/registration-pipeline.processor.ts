import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { RegistrationSource, RegistrationStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { DigitalTicketsService } from '../../digital-tickets/digital-tickets.service';
import { QrImageService } from '../../qr/qr-image.service';
import { QrService } from '../../qr/qr.service';
import { QUEUE_NAMES } from '../queue.constants';

type RegistrationCreatedJob = {
  registrationId: string;
  eventId: string;
  source: RegistrationSource;
};

@Processor(QUEUE_NAMES.REGISTRATION_PIPELINE)
export class RegistrationPipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(RegistrationPipelineProcessor.name);

  constructor(
    private readonly digitalTicketsService: DigitalTicketsService,
    private readonly prisma: PrismaService,
    private readonly qrImageService: QrImageService,
    private readonly qrService: QrService,
    @InjectQueue(QUEUE_NAMES.DIGITAL_TICKET_GENERATION)
    private readonly digitalTicketGenerationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<RegistrationCreatedJob>) {
    await job.updateProgress(10);

    const registration = await this.prisma.registration.findUnique({
      where: { id: job.data.registrationId },
      include: {
        qrToken: true,
      },
    });

    if (!registration) {
      return {
        registrationId: job.data.registrationId,
        qrGenerated: false,
        ticketQueued: false,
        whatsappQueued: false,
        skippedReason: 'REGISTRATION_NOT_FOUND',
      };
    }

    if (registration.status !== RegistrationStatus.ACTIVE) {
      return {
        registrationId: registration.id,
        qrGenerated: false,
        ticketQueued: false,
        whatsappQueued: false,
        skippedReason: 'REGISTRATION_INACTIVE',
      };
    }

    const hadQrToken = Boolean(registration.qrToken);
    const qr = await this.qrService.generate(registration.id);
    await job.updateProgress(45);

    await this.qrImageService.generateRegistrationQrImage({
      registrationPublicId: registration.publicId,
      qrToken: qr.qrToken,
    });
    await job.updateProgress(70);

    const ticketJob = await this.enqueueDigitalTicketGeneration({
      registrationId: registration.id,
      eventId: registration.eventId,
    });
    await job.updateProgress(100);

    return {
      registrationId: registration.id,
      qrGenerated: !hadQrToken,
      ticketQueued: ticketJob.queued,
      ticketJobId: ticketJob.jobId,
      whatsappQueued: false,
      skippedReason: ticketJob.skippedReason,
    };
  }

  private async enqueueDigitalTicketGeneration(input: {
    registrationId: string;
    eventId: string;
  }) {
    try {
      const template =
        await this.digitalTicketsService.resolveActiveTemplateForRegistration(
          input.registrationId,
        );
      const jobId = `digital-ticket:${input.registrationId}:${template.version}`;
      const existingJob = await this.digitalTicketGenerationQueue.getJob(jobId);

      if (existingJob) {
        return { queued: true, jobId, skippedReason: 'TICKET_JOB_EXISTS' };
      }

      const job = await this.digitalTicketGenerationQueue.add(
        'digital-ticket.generate',
        {
          registrationId: input.registrationId,
          eventId: input.eventId,
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        },
      );

      return { queued: true, jobId: String(job.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('Active digital ticket template not found')) {
        this.logger.warn(
          `DIGITAL_TICKET_TEMPLATE_NOT_FOUND registration=${input.registrationId}`,
        );
      } else {
        this.logger.error(
          `Failed to enqueue digital ticket generation for ${input.registrationId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      return {
        queued: false,
        skippedReason: message.includes('Active digital ticket template not found')
          ? 'DIGITAL_TICKET_TEMPLATE_NOT_FOUND'
          : 'DIGITAL_TICKET_ENQUEUE_FAILED',
      };
    }
  }
}
