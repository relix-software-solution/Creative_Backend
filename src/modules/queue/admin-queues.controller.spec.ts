import { AdminQueuesController } from './admin-queues.controller';

describe('AdminQueuesController', () => {
  it('returns WhatsApp queue counts', async () => {
    const controller = new AdminQueuesController(
      {
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 1,
          active: 2,
          delayed: 3,
          completed: 4,
          failed: 5,
        }),
        isPaused: jest.fn().mockResolvedValue(false),
      } as never,
      {
        get: jest.fn().mockReturnValue(3),
      } as never,
    );

    await expect(controller.getWhatsAppQueue()).resolves.toEqual({
      queue: 'whatsapp-notifications',
      waiting: 1,
      active: 2,
      delayed: 3,
      completedRetained: 4,
      failed: 5,
      paused: false,
      ratePerSecond: 3,
    });
  });
});
