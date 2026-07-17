import { DigitalTicketGenerationProcessor } from './digital-ticket-generation.processor';

describe('DigitalTicketGenerationProcessor', () => {
  it('generates a ticket image without queueing WhatsApp', async () => {
    const processor = new DigitalTicketGenerationProcessor(
      {
        generateForRegistration: jest.fn().mockResolvedValue({
          id: 'image-1',
          imageUrl: 'https://example.com/uploads/digital-tickets/generated/1.png',
        }),
      } as never,
    );

    await expect(
      processor.process({
        data: { registrationId: 'reg-1', eventId: 'event-1' },
        opts: { attempts: 3 },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as never),
    ).resolves.toMatchObject({
      digitalTicketImageId: 'image-1',
      whatsappQueued: false,
    });
  });
});
