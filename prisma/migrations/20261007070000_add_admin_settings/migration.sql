CREATE TABLE `AdminSetting` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'system',
  `organizationName` VARCHAR(191) NOT NULL DEFAULT 'Creative Group For Event Services',
  `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Damascus',
  `defaultLocale` VARCHAR(191) NOT NULL DEFAULT 'ar',
  `reportExportMaxRows` INTEGER NOT NULL DEFAULT 10000,
  `reportDefaultRangeDays` INTEGER NOT NULL DEFAULT 30,
  `notificationSummaryHours` INTEGER NOT NULL DEFAULT 24,
  `notificationAlertThreshold` INTEGER NOT NULL DEFAULT 1,
  `notificationPollingSeconds` INTEGER NOT NULL DEFAULT 30,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
