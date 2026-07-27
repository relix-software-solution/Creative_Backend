import 'dotenv/config';

import { Prisma, PrismaClient, RegistrationStatus } from '@prisma/client';

import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Check the backend .env file.');
}

const parsedDatabaseUrl = new URL(databaseUrl);

if (
  parsedDatabaseUrl.protocol !== 'mysql:' &&
  parsedDatabaseUrl.protocol !== 'mariadb:'
) {
  throw new Error(
    `Unsupported database protocol: ${parsedDatabaseUrl.protocol}`,
  );
}

const databaseName = parsedDatabaseUrl.pathname.replace(/^\/+/, '').trim();

if (!databaseName) {
  throw new Error('Database name is missing from DATABASE_URL.');
}

const adapter = new PrismaMariaDb({
  host: parsedDatabaseUrl.hostname,

  port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 3306,

  user: decodeURIComponent(parsedDatabaseUrl.username),

  password: decodeURIComponent(parsedDatabaseUrl.password),

  database: databaseName,

  /*
   * السكربت يعمل على دفعات، ولا يحتاج Pool كبيرًا.
   */
  connectionLimit: 3,
});

const prisma = new PrismaClient({
  adapter,
});

const BATCH_SIZE = 100;

async function deleteRegistrationGraph(
  tx: Prisma.TransactionClient,
  registrationIds: string[],
) {
  await tx.offlineScanOperation.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.offlineRegistrationMapping.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.digitalTicketImage.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.notificationLog.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.importRow.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  /*
   * الحركات قبل السكانات الخام.
   */
  await tx.movementLog.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.scanEventRaw.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  await tx.qrToken.deleteMany({
    where: {
      registrationId: {
        in: registrationIds,
      },
    },
  });

  return tx.registration.deleteMany({
    where: {
      id: {
        in: registrationIds,
      },

      /*
       * حماية إضافية حتى لا نحذف أي تسجيل فعال.
       */
      status: RegistrationStatus.ARCHIVED,
    },
  });
}

async function main() {
  const archivedCount = await prisma.registration.count({
    where: {
      status: RegistrationStatus.ARCHIVED,
    },
  });

  console.log(`Archived registrations found: ${archivedCount}`);

  if (archivedCount === 0) {
    console.log('Nothing to purge.');
    return;
  }

  if (process.env.CONFIRM_PURGE_ARCHIVED !== 'YES') {
    throw new Error(
      'Purge cancelled. Set CONFIRM_PURGE_ARCHIVED=YES to continue.',
    );
  }

  let deletedCount = 0;

  while (true) {
    const registrations = await prisma.registration.findMany({
      where: {
        status: RegistrationStatus.ARCHIVED,
      },

      select: {
        id: true,
      },

      take: BATCH_SIZE,
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (registrations.length === 0) {
      break;
    }

    const ids = registrations.map((registration) => registration.id);

    const result = await prisma.$transaction(async (tx) => {
      return deleteRegistrationGraph(tx, ids);
    });

    deletedCount += result.count;

    console.log(`Deleted ${deletedCount} of ${archivedCount}`);
  }

  const remainingCount = await prisma.registration.count({
    where: {
      status: RegistrationStatus.ARCHIVED,
    },
  });

  console.log({
    archivedBefore: archivedCount,
    deleted: deletedCount,
    remaining: remainingCount,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
