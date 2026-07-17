import { DigitalTicketsService } from './digital-tickets.service';

function createRegistration() {
  return {
    id: 'registration-1',
    publicId: 'REG_001',
    eventId: 'event-1',
    attendeeTypeId: 'attendee-1',
    status: 'ACTIVE',
    fullName: 'Visitor One',
    phone: '+963900000000',
    email: 'visitor@example.com',
    companyName: 'Acme',
    jobTitle: 'Manager',
    externalId: 'EXT-1',
    customFields: { company: 'Acme Custom' },
    attendeeType: { id: 'attendee-1' },
    event: {
      id: 'event-1',
      titleAr: 'Event AR',
      titleEn: 'Event EN',
      descriptionAr: 'Arabic event description',
      descriptionEn: 'English event description',
      startsAt: new Date('2026-01-01T10:00:00.000Z'),
      timezone: 'UTC',
      branding: {
        isActive: true,
        logoUrl: null,
        backgroundImageUrl: null,
      },
      venues: [{ nameAr: 'Main Venue', nameEn: 'Main Venue' }],
    },
  };
}

function createTemplate() {
  return {
    id: 'template-1',
    eventId: 'event-1',
    attendeeTypeId: 'attendee-1',
    attendeeTypeScopeKey: 'attendee-1',
    name: 'Ticket',
    widthPx: 1080,
    heightPx: 1920,
    backgroundImageUrl: null,
    backgroundImagePath: null,
    theme: {},
    elements: [{ type: 'FIELD', fieldKey: 'fullName' }],
    selectedFields: [{ key: 'fullName', source: 'FIXED' }],
    version: 2,
    isActive: true,
  };
}

function createService() {
  const registration = createRegistration();
  const template = createTemplate();
  const prisma = {
    registration: {
      findUnique: jest.fn().mockResolvedValue(registration),
      findFirst: jest.fn().mockResolvedValue(registration),
    },
    digitalTicketTemplate: {
      findMany: jest.fn().mockResolvedValue([template]),
      findFirst: jest.fn().mockResolvedValue(template),
    },
    digitalTicketImage: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({
        id: 'image-1',
        registrationId: 'registration-1',
      }),
    },
  };
  const badgeTemplatesService = {
    getAvailableFieldDefinitions: jest.fn().mockResolvedValue([
      { key: 'fullName', source: 'FIXED', type: 'TEXT' },
      { key: 'qrCode', source: 'SYSTEM', type: 'QR' },
    ]),
  };
  const imageService = {
    isGeneratedImageUsable: jest.fn().mockResolvedValue(true),
    deleteGeneratedImage: jest.fn().mockResolvedValue({ deleted: true }),
    saveGeneratedImage: jest.fn().mockResolvedValue({
      id: 'image-1',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/1.png',
      relativePath: '/uploads/digital-tickets/generated/1.png',
    }),
    savePreviewImage: jest.fn().mockResolvedValue({
      imageUrl: 'https://example.com/uploads/digital-tickets/previews/1.png',
      relativePath: '/uploads/digital-tickets/previews/1.png',
    }),
  };
  const qrImageService = {
    generateRegistrationQrImage: jest.fn().mockResolvedValue({
      filePath: 'qr.png',
      imageUrl: 'https://example.com/uploads/qr/REG_001.png',
      relativePath: '/uploads/qr/REG_001.png',
    }),
  };
  const qrService = {
    generate: jest.fn().mockResolvedValue({
      qrToken: 'signed.full.qr',
      compactQrToken: 'compact.qr',
      payload: { tokenId: 'QRT_001' },
    }),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue(Buffer.from('png')),
  };

  return {
    badgeTemplatesService,
    imageService,
    prisma,
    qrImageService,
    qrService,
    renderer,
    service: new DigitalTicketsService(
      badgeTemplatesService as never,
      imageService as never,
      prisma as never,
      qrImageService as never,
      qrService as never,
      renderer as never,
    ),
  };
}

describe('DigitalTicketsService', () => {
  it('generates QR image when missing and saves ticket metadata', async () => {
    const { imageService, qrImageService, service } = createService();

    await expect(
      service.generateForRegistration('registration-1'),
    ).resolves.toMatchObject({
      id: 'image-1',
      templateVersion: 2,
    });
    expect(qrImageService.generateRegistrationQrImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationPublicId: 'REG_001',
        qrToken: 'compact.qr',
      }),
    );
    expect(qrImageService.generateRegistrationQrImage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        qrToken: expect.stringContaining('signed.full.qr'),
      }),
    );
    expect(imageService.saveGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: 'registration-1',
        templateId: 'template-1',
        templateVersion: 2,
      }),
    );
  });

  it('returns an existing same-version image without regenerating', async () => {
    const { imageService, prisma, renderer, service } = createService();
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce({
      id: 'existing-image',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/existing.png',
      relativePath: '/uploads/digital-tickets/generated/existing.png',
      templateVersion: 2,
    });

    await expect(
      service.generateForRegistration('registration-1'),
    ).resolves.toMatchObject({
      id: 'existing-image',
      reused: true,
    });
    expect(renderer.render).not.toHaveBeenCalled();
    expect(imageService.saveGeneratedImage).not.toHaveBeenCalled();
  });

  it('regenerates an unusable same-version image without creating a duplicate row', async () => {
    const { imageService, prisma, renderer, service } = createService();
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce({
      id: 'existing-image',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/empty.png',
      relativePath: '/uploads/digital-tickets/generated/empty.png',
      templateVersion: 2,
    });
    imageService.isGeneratedImageUsable.mockResolvedValueOnce(false);

    await expect(
      service.generateForRegistration('registration-1'),
    ).resolves.toMatchObject({
      id: 'image-1',
      templateVersion: 2,
    });
    expect(renderer.render).toHaveBeenCalled();
    expect(imageService.saveGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: 'registration-1',
        templateId: 'template-1',
        templateVersion: 2,
      }),
    );
    expect(imageService.deleteGeneratedImage).toHaveBeenCalledWith(
      '/uploads/digital-tickets/generated/empty.png',
    );
  });

  it('force regenerates a valid same-version image and replaces the old output', async () => {
    const { imageService, prisma, renderer, service } = createService();
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce({
      id: 'existing-image',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/existing.png',
      relativePath: '/uploads/digital-tickets/generated/existing.png',
      templateVersion: 2,
    });

    await expect(
      service.generateForRegistration('registration-1', {
        forceRegenerate: true,
      }),
    ).resolves.toMatchObject({
      id: 'image-1',
      templateVersion: 2,
    });
    expect(imageService.isGeneratedImageUsable).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalled();
    expect(imageService.saveGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: 'registration-1',
        templateId: 'template-1',
        templateVersion: 2,
      }),
    );
    expect(imageService.deleteGeneratedImage).toHaveBeenCalledWith(
      '/uploads/digital-tickets/generated/existing.png',
    );
  });

  it('resolves an existing usable current-template image without regeneration', async () => {
    const { imageService, prisma, service } = createService();
    const existingImage = {
      id: 'existing-image',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/existing.png',
      relativePath: '/uploads/digital-tickets/generated/existing.png',
      templateVersion: 2,
    };
    prisma.digitalTicketImage.findUnique.mockResolvedValueOnce(existingImage);
    const generate = jest.spyOn(service, 'generateForRegistration');

    await expect(
      service.resolveUsableForRegistration('registration-1'),
    ).resolves.toEqual(existingImage);
    expect(imageService.isGeneratedImageUsable).toHaveBeenCalledWith(
      existingImage.relativePath,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('safely regenerates when the current-template image is missing', async () => {
    const { service } = createService();
    const generated = {
      id: 'generated-image',
      imageUrl: 'https://example.com/uploads/digital-tickets/generated/new.png',
      relativePath: '/uploads/digital-tickets/generated/new.png',
    };
    const generate = jest
      .spyOn(service, 'generateForRegistration')
      .mockResolvedValueOnce(generated as never);

    await expect(
      service.resolveUsableForRegistration('registration-1'),
    ).resolves.toEqual(generated);
    expect(generate).toHaveBeenCalledWith('registration-1');
  });

  it('generates a preview image without saving DigitalTicketImage metadata', async () => {
    const { imageService, renderer, service } = createService();

    await expect(
      service.previewForEvent('event-1', {
        registrationId: 'registration-1',
        widthPx: 800,
        heightPx: 1200,
        selectedFields: [{ key: 'fullName', source: 'FIXED' }],
      }),
    ).resolves.toMatchObject({
      relativePath: '/uploads/digital-tickets/previews/1.png',
    });
    expect(imageService.savePreviewImage).toHaveBeenCalled();
    expect(imageService.saveGeneratedImage).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          ticketLocale: 'ar',
          ticketTitle: 'بطاقة الدخول الرقمية',
          eventDescription: 'Arabic event description',
          eventDateFormatted: expect.not.stringContaining('T'),
          eventTimeFormatted: expect.not.stringContaining('T'),
        }),
      }),
    );
  });

  it('uses English localized fields when an existing locale custom field requests English', async () => {
    const { prisma, renderer, service } = createService();
    prisma.registration.findUnique.mockResolvedValueOnce({
      ...createRegistration(),
      customFields: { locale: 'en' },
    });

    await service.previewForEvent('event-1', {
      registrationId: 'registration-1',
      widthPx: 800,
      heightPx: 1200,
      selectedFields: [{ key: 'fullName', source: 'FIXED' }],
    });

    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          ticketLocale: 'en',
          ticketTitle: 'Digital Entry Ticket',
          eventDescription: 'English event description',
          eventDateFormatted: '01 January 2026',
          eventTimeFormatted: '10:00 AM',
        }),
      }),
    );
  });
});
