import { BadgeTemplatesService } from './badge-templates.service';

describe('BadgeTemplatesService image lifecycle', () => {
  it('clears the badge background image URL', async () => {
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      eventBadgeTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          eventId: 'event-1',
          backgroundImageUrl: '/uploads/badge-templates/old.png',
        }),
        update: jest.fn().mockResolvedValue({
          eventId: 'event-1',
          backgroundImageUrl: null,
        }),
      },
    };
    const service = new BadgeTemplatesService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(service.removeBackgroundImage('event-1')).resolves.toEqual({
      eventId: 'event-1',
      field: 'backgroundImageUrl',
      removed: true,
      alreadyMissing: false,
      entity: {
        eventId: 'event-1',
        backgroundImageUrl: null,
      },
    });
    expect(prisma.eventBadgeTemplate.update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: { backgroundImageUrl: null },
    });
  });
});
