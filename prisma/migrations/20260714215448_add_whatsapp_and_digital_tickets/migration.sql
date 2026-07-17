/*
  Warnings:

  - A unique constraint covering the columns `[dedupeKey]` on the table `NotificationLog` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `NotificationLog` ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
    ADD COLUMN `notificationType` ENUM('REGISTRATION_QR', 'IMPORT_QR', 'GENERIC') NULL;

-- CreateTable
CREATE TABLE `DigitalTicketTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `attendeeTypeId` VARCHAR(191) NULL,
    `attendeeTypeScopeKey` VARCHAR(191) NOT NULL DEFAULT '__EVENT__',
    `name` VARCHAR(191) NOT NULL,
    `widthPx` INTEGER NOT NULL,
    `heightPx` INTEGER NOT NULL,
    `backgroundImageUrl` VARCHAR(191) NULL,
    `backgroundImagePath` VARCHAR(191) NULL,
    `theme` JSON NOT NULL,
    `elements` JSON NOT NULL,
    `selectedFields` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DigitalTicketTemplate_eventId_idx`(`eventId`),
    INDEX `DigitalTicketTemplate_attendeeTypeId_idx`(`attendeeTypeId`),
    INDEX `DigitalTicketTemplate_isActive_idx`(`isActive`),
    INDEX `DigitalTicketTemplate_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `DigitalTicketTemplate_eventId_attendeeTypeScopeKey_key`(`eventId`, `attendeeTypeScopeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DigitalTicketImage` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `relativePath` VARCHAR(191) NOT NULL,
    `templateVersion` INTEGER NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DigitalTicketImage_eventId_idx`(`eventId`),
    INDEX `DigitalTicketImage_registrationId_idx`(`registrationId`),
    INDEX `DigitalTicketImage_templateId_idx`(`templateId`),
    INDEX `DigitalTicketImage_generatedAt_idx`(`generatedAt`),
    UNIQUE INDEX `DigitalTicketImage_registrationId_templateId_templateVersion_key`(`registrationId`, `templateId`, `templateVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `NotificationLog_dedupeKey_key` ON `NotificationLog`(`dedupeKey`);

-- CreateIndex
CREATE INDEX `NotificationLog_notificationType_idx` ON `NotificationLog`(`notificationType`);

-- AddForeignKey
ALTER TABLE `DigitalTicketTemplate` ADD CONSTRAINT `DigitalTicketTemplate_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DigitalTicketTemplate` ADD CONSTRAINT `DigitalTicketTemplate_attendeeTypeId_fkey` FOREIGN KEY (`attendeeTypeId`) REFERENCES `AttendeeType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DigitalTicketImage` ADD CONSTRAINT `DigitalTicketImage_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DigitalTicketImage` ADD CONSTRAINT `DigitalTicketImage_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DigitalTicketImage` ADD CONSTRAINT `DigitalTicketImage_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `DigitalTicketTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
