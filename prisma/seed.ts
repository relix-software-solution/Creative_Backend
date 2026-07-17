import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  CheckpointType,
  DeviceStatus,
  EventStatus,
  EventType,
  Prisma,
  PrismaClient,
  RegistrationFieldType,
  RegistrationSource,
  RegistrationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { hashApiKey } from '../src/common/utils/api-key.util';
import { hashPassword } from '../src/common/utils/password.util';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

const ids = {
  adminUser: 'seed_user_admin',
  staffUser: 'seed_user_staff',
  client: 'seed_client_test_exhibition',
  event: 'seed_event_test_exhibition',
  branding: 'seed_branding_test_exhibition',
  badgeTemplate: 'seed_badge_template_test_exhibition',
  venue: 'seed_venue_exhibition_center',
  zone: 'seed_zone_main_hall',
  checkpoint: 'seed_checkpoint_main_gate',
  visitorAttendeeType: 'seed_attendee_type_visitor',
  vipAttendeeType: 'seed_attendee_type_vip',
  companyField: 'seed_registration_field_company',
  jobTitleField: 'seed_registration_field_job_title',
  countryField: 'seed_registration_field_country',
  registrationAhmad: 'seed_registration_ahmad',
  registrationSara: 'seed_registration_sara',
  registrationYaser: 'seed_registration_yaser',
  device: 'seed_device_main_scanner',
  staffAssignment: 'seed_staff_assignment_main',
} as const;

const credentials = {
  adminEmail: 'admin@eventops.test',
  adminPhone: '+963900000001',
  adminPassword: 'Admin123456',
  staffEmail: 'staff@eventops.test',
  staffPhone: '+963900000002',
  staffPassword: 'Staff123456',
  deviceApiKey:
    'eventops_test_SCANNER_MAIN_01_7f3b76a7f6634ae0a88088417f5f16af',
} as const;

async function upsertSeedUser(input: {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
}) {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ id: input.id }, { email: input.email }, { phone: input.phone }],
    },
  });
  const data = {
    email: input.email,
    phone: input.phone,
    passwordHash: input.passwordHash,
    fullName: input.fullName,
    role: input.role,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.user.create({
    data: {
      id: input.id,
      ...data,
    },
  });
}

async function upsertRegistrationField(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    eventId: string;
    key: string;
    labelAr: string;
    labelEn: string;
    sortOrder: number;
  },
) {
  const existing = await tx.registrationField.findFirst({
    where: {
      eventId: input.eventId,
      key: input.key,
      attendeeTypeId: null,
    },
  });
  const data = {
    eventId: input.eventId,
    attendeeTypeId: null,
    key: input.key,
    labelAr: input.labelAr,
    labelEn: input.labelEn,
    type: RegistrationFieldType.TEXT,
    isRequired: false,
    isUnique: false,
    sortOrder: input.sortOrder,
    isActive: true,
  };

  if (existing) {
    return tx.registrationField.update({
      where: { id: existing.id },
      data,
    });
  }

  return tx.registrationField.create({
    data: {
      id: input.id,
      ...data,
    },
  });
}

async function main(): Promise<void> {
  const [adminPasswordHash, staffPasswordHash] = await Promise.all([
    hashPassword(credentials.adminPassword),
    hashPassword(credentials.staffPassword),
  ]);

  const admin = await upsertSeedUser({
    id: ids.adminUser,
    email: credentials.adminEmail,
    phone: credentials.adminPhone,
    passwordHash: adminPasswordHash,
    fullName: 'Admin User',
    role: UserRole.SUPER_ADMIN,
  });
  const staff = await upsertSeedUser({
    id: ids.staffUser,
    email: credentials.staffEmail,
    phone: credentials.staffPhone,
    passwordHash: staffPasswordHash,
    fullName: 'Staff User',
    role: UserRole.STAFF,
  });

  const now = new Date();
  const startsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const seeded = await prisma.$transaction(
    async (tx) => {
      const client = await tx.client.upsert({
        where: { id: ids.client },
        update: {
          name: 'Test Exhibition Client',
          contactName: 'Test Client',
          contactEmail: 'client@eventops.test',
          contactPhone: '+963900000010',
          isActive: true,
        },
        create: {
          id: ids.client,
          name: 'Test Exhibition Client',
          contactName: 'Test Client',
          contactEmail: 'client@eventops.test',
          contactPhone: '+963900000010',
          isActive: true,
        },
      });

      const event = await tx.event.upsert({
        where: { id: ids.event },
        update: {
          clientId: client.id,
          titleAr: 'معرض الاختبار',
          titleEn: 'Test Exhibition',
          descriptionAr: 'فعالية مخصصة لاختبار النظام بالكامل',
          descriptionEn: 'Full system test event',
          status: EventStatus.ACTIVE,
          type: EventType.EXHIBITION,
          allowReEntry: false,
          duplicateStrategy: 'PHONE',
          startsAt,
          endsAt,
          qrValidFrom: startsAt,
          qrValidUntil: endsAt,
          isActive: true,
        },
        create: {
          id: ids.event,
          clientId: client.id,
          titleAr: 'معرض الاختبار',
          titleEn: 'Test Exhibition',
          descriptionAr: 'فعالية مخصصة لاختبار النظام بالكامل',
          descriptionEn: 'Full system test event',
          status: EventStatus.ACTIVE,
          type: EventType.EXHIBITION,
          allowReEntry: false,
          duplicateStrategy: 'PHONE',
          startsAt,
          endsAt,
          qrValidFrom: startsAt,
          qrValidUntil: endsAt,
          isActive: true,
        },
      });

      await tx.eventBranding.upsert({
        where: { eventId: event.id },
        update: {
          logoUrl: '/uploads/event-branding/test-logo.png',
          backgroundImageUrl: '/uploads/event-branding/test-background.png',
          certificateImageUrl:
            '/uploads/event-branding/test-certificate.png',
          theme: {
            primary: '#A88042',
            primaryHover: '#8F6D37',
            background: '#F8F8FF',
            text: '#4B4B4B',
            radius: '1.5rem',
          },
          isActive: true,
        },
        create: {
          id: ids.branding,
          eventId: event.id,
          logoUrl: '/uploads/event-branding/test-logo.png',
          backgroundImageUrl: '/uploads/event-branding/test-background.png',
          certificateImageUrl:
            '/uploads/event-branding/test-certificate.png',
          theme: {
            primary: '#A88042',
            primaryHover: '#8F6D37',
            background: '#F8F8FF',
            text: '#4B4B4B',
            radius: '1.5rem',
          },
          isActive: true,
        },
      });

      const badgeTemplate = await tx.eventBadgeTemplate.upsert({
        where: { eventId: event.id },
        update: {
          name: 'Default Test Badge',
          widthMm: 90,
          heightMm: 120,
          backgroundImageUrl: '/uploads/badge-templates/test-badge-bg.png',
          colors: {
            primary: '#A88042',
            text: '#4B4B4B',
            background: '#FFFFFF',
          },
          selectedFields: [
            { key: 'fullName', source: 'FIXED', label: 'Name', visible: true },
            {
              key: 'company',
              source: 'CUSTOM',
              label: 'Company',
              visible: true,
            },
            {
              key: 'jobTitle',
              source: 'CUSTOM',
              label: 'Job Title',
              visible: true,
            },
            { key: 'qrCode', source: 'SYSTEM', label: 'QR', visible: true },
          ],
          layout: {
            fields: {
              fullName: {
                x: 10,
                y: 20,
                fontSize: 18,
                bold: true,
                textColor: '#333333',
                boldColor: '#000000',
              },
              company: {
                x: 10,
                y: 35,
                fontSize: 12,
                bold: false,
                textColor: '#555555',
              },
              jobTitle: { x: 10, y: 45, fontSize: 12, textColor: '#555555' },
              qrCode: { x: 60, y: 20, width: 25, height: 25 },
            },
          },
          isActive: true,
        },
        create: {
          id: ids.badgeTemplate,
          eventId: event.id,
          name: 'Default Test Badge',
          widthMm: 90,
          heightMm: 120,
          backgroundImageUrl: '/uploads/badge-templates/test-badge-bg.png',
          colors: {
            primary: '#A88042',
            text: '#4B4B4B',
            background: '#FFFFFF',
          },
          selectedFields: [
            { key: 'fullName', source: 'FIXED', label: 'Name', visible: true },
            {
              key: 'company',
              source: 'CUSTOM',
              label: 'Company',
              visible: true,
            },
            {
              key: 'jobTitle',
              source: 'CUSTOM',
              label: 'Job Title',
              visible: true,
            },
            { key: 'qrCode', source: 'SYSTEM', label: 'QR', visible: true },
          ],
          layout: {
            fields: {
              fullName: {
                x: 10,
                y: 20,
                fontSize: 18,
                bold: true,
                textColor: '#333333',
                boldColor: '#000000',
              },
              company: {
                x: 10,
                y: 35,
                fontSize: 12,
                bold: false,
                textColor: '#555555',
              },
              jobTitle: { x: 10, y: 45, fontSize: 12, textColor: '#555555' },
              qrCode: { x: 60, y: 20, width: 25, height: 25 },
            },
          },
          isActive: true,
        },
      });

      const venue = await tx.venue.upsert({
        where: { id: ids.venue },
        update: {
          eventId: event.id,
          nameAr: 'أرض المعارض',
          nameEn: 'Exhibition Center',
        },
        create: {
          id: ids.venue,
          eventId: event.id,
          nameAr: 'أرض المعارض',
          nameEn: 'Exhibition Center',
        },
      });

      const zone = await tx.zone.upsert({
        where: { id: ids.zone },
        update: {
          eventId: event.id,
          venueId: venue.id,
          parentId: null,
          nameAr: 'القاعة الرئيسية',
          nameEn: 'Main Hall',
          code: 'MAIN_HALL',
          sortOrder: 1,
        },
        create: {
          id: ids.zone,
          eventId: event.id,
          venueId: venue.id,
          nameAr: 'القاعة الرئيسية',
          nameEn: 'Main Hall',
          code: 'MAIN_HALL',
          sortOrder: 1,
        },
      });

      const visitorAttendeeType = await tx.attendeeType.upsert({
        where: {
          eventId_code: {
            eventId: event.id,
            code: 'VISITOR',
          },
        },
        update: {
          nameAr: 'زائر',
          nameEn: 'Visitor',
          isDefault: true,
          isActive: true,
          sortOrder: 1,
        },
        create: {
          id: ids.visitorAttendeeType,
          eventId: event.id,
          code: 'VISITOR',
          nameAr: 'زائر',
          nameEn: 'Visitor',
          isDefault: true,
          isActive: true,
          sortOrder: 1,
        },
      });

      const vipAttendeeType = await tx.attendeeType.upsert({
        where: {
          eventId_code: {
            eventId: event.id,
            code: 'VIP',
          },
        },
        update: {
          nameAr: 'ضيف VIP',
          nameEn: 'VIP Guest',
          isDefault: false,
          isActive: true,
          sortOrder: 2,
        },
        create: {
          id: ids.vipAttendeeType,
          eventId: event.id,
          code: 'VIP',
          nameAr: 'ضيف VIP',
          nameEn: 'VIP Guest',
          isDefault: false,
          isActive: true,
          sortOrder: 2,
        },
      });

      await Promise.all([
        upsertRegistrationField(tx, {
          id: ids.companyField,
          eventId: event.id,
          key: 'company',
          labelAr: 'الشركة',
          labelEn: 'Company',
          sortOrder: 1,
        }),
        upsertRegistrationField(tx, {
          id: ids.jobTitleField,
          eventId: event.id,
          key: 'jobTitle',
          labelAr: 'المسمى الوظيفي',
          labelEn: 'Job Title',
          sortOrder: 2,
        }),
        upsertRegistrationField(tx, {
          id: ids.countryField,
          eventId: event.id,
          key: 'country',
          labelAr: 'الدولة',
          labelEn: 'Country',
          sortOrder: 3,
        }),
      ]);

      const checkpoint = await tx.checkpoint.upsert({
        where: {
          eventId_code: {
            eventId: event.id,
            code: 'MAIN_GATE',
          },
        },
        update: {
          venueId: venue.id,
          zoneId: zone.id,
          type: CheckpointType.ENTRY,
          nameAr: 'البوابة الرئيسية',
          nameEn: 'Main Gate',
          allowedAttendeeTypes: [visitorAttendeeType.id, vipAttendeeType.id],
          isActive: true,
          sortOrder: 1,
        },
        create: {
          id: ids.checkpoint,
          eventId: event.id,
          venueId: venue.id,
          zoneId: zone.id,
          type: CheckpointType.ENTRY,
          nameAr: 'البوابة الرئيسية',
          nameEn: 'Main Gate',
          code: 'MAIN_GATE',
          allowedAttendeeTypes: [visitorAttendeeType.id, vipAttendeeType.id],
          isActive: true,
          sortOrder: 1,
        },
      });

      const registrations = await Promise.all([
        tx.registration.upsert({
          where: {
            eventId_externalId: {
              eventId: event.id,
              externalId: 'SEED-REG-001',
            },
          },
          update: {
            attendeeTypeId: visitorAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Ahmad Visitor',
            phone: '+963944111001',
            email: 'ahmad.visitor@example.com',
            customFields: {
              company: 'Alpha Co',
              jobTitle: 'Engineer',
              country: 'Syria',
            },
          },
          create: {
            id: ids.registrationAhmad,
            publicId: 'REG_SEED_001',
            eventId: event.id,
            attendeeTypeId: visitorAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Ahmad Visitor',
            phone: '+963944111001',
            email: 'ahmad.visitor@example.com',
            externalId: 'SEED-REG-001',
            customFields: {
              company: 'Alpha Co',
              jobTitle: 'Engineer',
              country: 'Syria',
            },
          },
        }),
        tx.registration.upsert({
          where: {
            eventId_externalId: {
              eventId: event.id,
              externalId: 'SEED-REG-002',
            },
          },
          update: {
            attendeeTypeId: vipAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Sara VIP',
            phone: '+963944111002',
            email: 'sara.vip@example.com',
            customFields: {
              company: 'Beta Co',
              jobTitle: 'Manager',
              country: 'UAE',
            },
          },
          create: {
            id: ids.registrationSara,
            publicId: 'REG_SEED_002',
            eventId: event.id,
            attendeeTypeId: vipAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Sara VIP',
            phone: '+963944111002',
            email: 'sara.vip@example.com',
            externalId: 'SEED-REG-002',
            customFields: {
              company: 'Beta Co',
              jobTitle: 'Manager',
              country: 'UAE',
            },
          },
        }),
        tx.registration.upsert({
          where: {
            eventId_externalId: {
              eventId: event.id,
              externalId: 'SEED-REG-003',
            },
          },
          update: {
            attendeeTypeId: visitorAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Yaser Test',
            phone: '+963944111003',
            email: 'yaser.test@example.com',
            customFields: {
              company: 'Qoutba',
              jobTitle: 'Developer',
              country: 'Syria',
            },
          },
          create: {
            id: ids.registrationYaser,
            publicId: 'REG_SEED_003',
            eventId: event.id,
            attendeeTypeId: visitorAttendeeType.id,
            status: RegistrationStatus.ACTIVE,
            source: RegistrationSource.ADMIN,
            fullName: 'Yaser Test',
            phone: '+963944111003',
            email: 'yaser.test@example.com',
            externalId: 'SEED-REG-003',
            customFields: {
              company: 'Qoutba',
              jobTitle: 'Developer',
              country: 'Syria',
            },
          },
        }),
      ]);

      const device = await tx.device.upsert({
        where: { code: 'SCANNER_MAIN_01' },
        update: {
          eventId: event.id,
          name: 'Main Scanner Device',
          apiKeyHash: hashApiKey(credentials.deviceApiKey),
          status: DeviceStatus.ACTIVE,
          metadata: {
            seeded: true,
            purpose: 'Complete Event Ops test scenario',
          },
        },
        create: {
          id: ids.device,
          eventId: event.id,
          name: 'Main Scanner Device',
          code: 'SCANNER_MAIN_01',
          apiKeyHash: hashApiKey(credentials.deviceApiKey),
          status: DeviceStatus.ACTIVE,
          metadata: {
            seeded: true,
            purpose: 'Complete Event Ops test scenario',
          },
        },
      });

      await tx.staffAssignment.updateMany({
        where: {
          userId: staff.id,
          isActive: true,
          NOT: {
            eventId: event.id,
          },
        },
        data: { isActive: false },
      });
      const staffAssignment = await tx.staffAssignment.upsert({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: staff.id,
          },
        },
        update: {
          checkpointId: checkpoint.id,
          deviceId: device.id,
          isActive: true,
          notes: 'Seeded scanner-ready assignment',
        },
        create: {
          id: ids.staffAssignment,
          eventId: event.id,
          userId: staff.id,
          checkpointId: checkpoint.id,
          deviceId: device.id,
          isActive: true,
          notes: 'Seeded scanner-ready assignment',
        },
      });

      return {
        client,
        event,
        badgeTemplate,
        venue,
        zone,
        checkpoint,
        visitorAttendeeType,
        vipAttendeeType,
        registrations,
        device,
        staffAssignment,
      };
    },
    {
      maxWait: 15_000,
      timeout: 60_000,
    },
  );

  // Cascade safety: child deletion never deletes its parent. Checkpoints delete
  // only themselves; zones and venues delete their descendants; events delete
  // all event-owned children.
  console.log(`
Event Ops deterministic test seed complete.

ADMIN:
adminEmail=${credentials.adminEmail}
adminPassword=${credentials.adminPassword}

STAFF:
staffEmail=${credentials.staffEmail}
staffPassword=${credentials.staffPassword}

IDS:
clientId=${seeded.client.id}
eventId=${seeded.event.id}
badgeTemplateId=${seeded.badgeTemplate.id}
venueId=${seeded.venue.id}
zoneId=${seeded.zone.id}
checkpointId=${seeded.checkpoint.id}
visitorAttendeeTypeId=${seeded.visitorAttendeeType.id}
vipAttendeeTypeId=${seeded.vipAttendeeType.id}
registrationId=${seeded.registrations[0].id}
deviceId=${seeded.device.id}
deviceApiKey=${credentials.deviceApiKey}
staffUserId=${staff.id}
staffAssignmentId=${seeded.staffAssignment.id}

QR:
QR generation was skipped to avoid NestJS DI/config side effects.
Use POST /qr/registrations/${seeded.registrations[0].id}/generate
`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
