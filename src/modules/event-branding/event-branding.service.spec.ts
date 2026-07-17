import { EventBrandingService } from './event-branding.service';

function createService(branding: {
  logoUrl: string | null;
  backgroundImageUrl: string | null;
  certificateImageUrl: string | null;
}) {
  const prisma = {
    event: {
      findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
    },
    eventBranding: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'branding-1',
        eventId: 'event-1',
        ...branding,
      }),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'branding-1',
          eventId: 'event-1',
          ...branding,
          ...data,
        }),
      ),
    },
  };

  return {
    prisma,
    service: new EventBrandingService(prisma as never),
  };
}

describe('EventBrandingService image lifecycle', () => {
  it('clears logo only', async () => {
    const { prisma, service } = createService({
      logoUrl: '/uploads/event-branding/logo.png',
      backgroundImageUrl: '/uploads/event-branding/bg.png',
      certificateImageUrl: '/uploads/event-branding/cert.png',
    });

    await expect(service.removeLogoImage('event-1')).resolves.toMatchObject({
      eventId: 'event-1',
      field: 'logoUrl',
      removed: true,
      alreadyMissing: false,
      entity: {
        logoUrl: null,
        backgroundImageUrl: '/uploads/event-branding/bg.png',
        certificateImageUrl: '/uploads/event-branding/cert.png',
      },
    });
    expect(prisma.eventBranding.update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: { logoUrl: null },
    });
  });

  it('clears background only', async () => {
    const { prisma, service } = createService({
      logoUrl: '/uploads/event-branding/logo.png',
      backgroundImageUrl: '/uploads/event-branding/bg.png',
      certificateImageUrl: '/uploads/event-branding/cert.png',
    });

    await expect(
      service.removeBackgroundImage('event-1'),
    ).resolves.toMatchObject({
      field: 'backgroundImageUrl',
      removed: true,
      entity: {
        logoUrl: '/uploads/event-branding/logo.png',
        backgroundImageUrl: null,
        certificateImageUrl: '/uploads/event-branding/cert.png',
      },
    });
    expect(prisma.eventBranding.update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: { backgroundImageUrl: null },
    });
  });

  it('clears certificate only', async () => {
    const { prisma, service } = createService({
      logoUrl: '/uploads/event-branding/logo.png',
      backgroundImageUrl: '/uploads/event-branding/bg.png',
      certificateImageUrl: '/uploads/event-branding/cert.png',
    });

    await expect(
      service.removeCertificateImage('event-1'),
    ).resolves.toMatchObject({
      field: 'certificateImageUrl',
      removed: true,
      entity: {
        logoUrl: '/uploads/event-branding/logo.png',
        backgroundImageUrl: '/uploads/event-branding/bg.png',
        certificateImageUrl: null,
      },
    });
    expect(prisma.eventBranding.update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: { certificateImageUrl: null },
    });
  });

  it('is idempotent when the image is already missing', async () => {
    const { prisma, service } = createService({
      logoUrl: null,
      backgroundImageUrl: null,
      certificateImageUrl: null,
    });

    await expect(service.removeLogoImage('event-1')).resolves.toMatchObject({
      field: 'logoUrl',
      removed: false,
      alreadyMissing: true,
    });
    expect(prisma.eventBranding.update).not.toHaveBeenCalled();
  });
});
