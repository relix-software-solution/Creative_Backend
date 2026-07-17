import { RegistrationSource, RegistrationStatus } from '@prisma/client';
import { RegistrationPipelineProcessor } from './registration-pipeline.processor';

describe('RegistrationPipelineProcessor', () => {
  it('generates QR and enqueues a digital ticket job instead of WhatsApp directly', async () => {
    const ticketQueue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue({ id: 'digital-ticket:reg-1:4' }),
    };
    const processor = new RegistrationPipelineProcessor(
      {
        resolveActiveTemplateForRegistration: jest.fn().mockResolvedValue({
          id: 'template-1',
          version: 4,
        }),
      } as never,
      {
        registration: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'reg-1',
            eventId: 'event-1',
            publicId: 'REG_001',
            status: RegistrationStatus.ACTIVE,
            qrToken: null,
          }),
        },
      } as never,
      {
        generateRegistrationQrImage: jest.fn().mockResolvedValue({}),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({ qrToken: 'signed.qr' }),
      } as never,
      ticketQueue as never,
    );

    await expect(
      processor.process({
        data: {
          registrationId: 'reg-1',
          eventId: 'event-1',
          source: RegistrationSource.ADMIN,
        },
        updateProgress: jest.fn(),
      } as never),
    ).resolves.toMatchObject({
      ticketQueued: true,
      ticketJobId: 'digital-ticket:reg-1:4',
    });
    expect(ticketQueue.add).toHaveBeenCalledWith(
      'digital-ticket.generate',
      { registrationId: 'reg-1', eventId: 'event-1' },
      expect.objectContaining({ jobId: 'digital-ticket:reg-1:4' }),
    );
  });

  it('does not send WhatsApp when no digital ticket template exists', async () => {
    const processor = new RegistrationPipelineProcessor(
      {
        resolveActiveTemplateForRegistration: jest
          .fn()
          .mockRejectedValue(
            new Error('Active digital ticket template not found'),
          ),
      } as never,
      {
        registration: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'reg-1',
            eventId: 'event-1',
            publicId: 'REG_001',
            status: RegistrationStatus.ACTIVE,
            qrToken: null,
          }),
        },
      } as never,
      {
        generateRegistrationQrImage: jest.fn().mockResolvedValue({}),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({ qrToken: 'signed.qr' }),
      } as never,
      { getJob: jest.fn(), add: jest.fn() } as never,
    );

    await expect(
      processor.process({
        data: {
          registrationId: 'reg-1',
          eventId: 'event-1',
          source: RegistrationSource.ADMIN,
        },
        updateProgress: jest.fn(),
      } as never),
    ).resolves.toMatchObject({
      ticketQueued: false,
      whatsappQueued: false,
      skippedReason: 'DIGITAL_TICKET_TEMPLATE_NOT_FOUND',
    });
  });
});
