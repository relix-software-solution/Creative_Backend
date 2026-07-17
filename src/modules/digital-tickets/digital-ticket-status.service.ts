import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegistrationSource } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { DigitalTicketImageService } from './image/digital-ticket-image.service';

export type DigitalTicketStatus =
  | 'PENDING'
  | 'READY'
  | 'FAILED'
  | 'NOT_CONFIGURED';

type RegistrationLike = {
  id: string;
  publicId: string;
  eventId: string;
  attendeeTypeId: string;
  source?: RegistrationSource;
};

type ResolveStatusInput = {
  registration: RegistrationLike;
  requestBaseUrl?: string;
  includePollUrl?: boolean;
  accessToken?: string | null;
};

export type DigitalTicketStatusResponse = {
  status: DigitalTicketStatus;
  imageUrl: string | null;
  relativePath: string | null;
  generatedAt: string | null;
  templateVersion: number | null;
  pollUrl?: string | null;
};

@Injectable()
export class DigitalTicketStatusService {
  private readonly logger = new Logger(DigitalTicketStatusService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly imageService: DigitalTicketImageService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.REGISTRATION_PIPELINE)
    private readonly registrationPipelineQueue: Queue,
  ) {}

  async resolveForRegistration(input: ResolveStatusInput) {
    const template = await this.findActiveTemplate(input.registration);

    if (!template) {
      return this.empty('NOT_CONFIGURED', input);
    }

    const existingImage = await this.prisma.digitalTicketImage.findUnique({
      where: {
        registrationId_templateId_templateVersion: {
          registrationId: input.registration.id,
          templateId: template.id,
          templateVersion: template.version,
        },
      },
    });

    if (
      existingImage &&
      (await this.imageService.isGeneratedImageUsable(existingImage.relativePath))
    ) {
      return {
        status: 'READY' as const,
        imageUrl: this.toPublicImageUrl(
          existingImage.imageUrl,
          existingImage.relativePath,
          input.requestBaseUrl,
        ),
        relativePath: existingImage.relativePath,
        generatedAt: existingImage.generatedAt?.toISOString?.() ?? null,
        templateVersion: existingImage.templateVersion,
        pollUrl: null,
      };
    }

    if (existingImage) {
      await this.enqueueRegeneration(input.registration);
    }

    return this.empty('PENDING', input);
  }

  private empty(
    status: Exclude<DigitalTicketStatus, 'READY'>,
    input: ResolveStatusInput,
  ): DigitalTicketStatusResponse {
    return {
      status,
      imageUrl: null,
      relativePath: null,
      generatedAt: null,
      templateVersion: null,
      pollUrl:
        status === 'PENDING' &&
        input.includePollUrl !== false &&
        input.accessToken
          ? this.buildPollUrl(input.registration.publicId, input.accessToken)
          : null,
    };
  }

  private async findActiveTemplate(registration: RegistrationLike) {
    const templates = await this.prisma.digitalTicketTemplate.findMany({
      where: {
        eventId: registration.eventId,
        isActive: true,
        OR: [
          { attendeeTypeId: registration.attendeeTypeId },
          { attendeeTypeId: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, attendeeTypeId: true, version: true },
    });

    return (
      templates.find((item) => item.attendeeTypeId === registration.attendeeTypeId) ??
      templates.find((item) => item.attendeeTypeId === null) ??
      null
    );
  }

  private async enqueueRegeneration(registration: RegistrationLike) {
    try {
      await this.registrationPipelineQueue.add(
        'registration.created',
        {
          registrationId: registration.id,
          eventId: registration.eventId,
          source: registration.source ?? RegistrationSource.PUBLIC,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Digital ticket regeneration queue unavailable for ${registration.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private toPublicImageUrl(
    imageUrl: string | null | undefined,
    relativePath: string | null | undefined,
    requestBaseUrl?: string,
  ) {
    const baseUrl = this.publicBaseUrl(requestBaseUrl);

    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      if (baseUrl && imageUrl.includes('://localhost')) {
        return this.joinUrl(baseUrl, new URL(imageUrl).pathname);
      }

      return imageUrl;
    }

    if (!relativePath) {
      return imageUrl ?? null;
    }

    return baseUrl ? this.joinUrl(baseUrl, relativePath) : relativePath;
  }

  private buildPollUrl(publicId: string, accessToken?: string | null) {
    const apiPrefix = this.configService.get<string>('API_PREFIX', 'api/v1');
    const path = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/public/registrations/${encodeURIComponent(publicId)}/digital-ticket`;

    if (!accessToken) {
      return path;
    }

    return `${path}?token=${encodeURIComponent(accessToken)}`;
  }

  private publicBaseUrl(requestBaseUrl?: string) {
    return (
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ||
      requestBaseUrl ||
      ''
    ).replace(/\/+$/, '');
  }

  private joinUrl(baseUrl: string, path: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }
}
