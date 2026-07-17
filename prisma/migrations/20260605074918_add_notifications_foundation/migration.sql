-- CreateTable
CREATE TABLE `NotificationTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NULL,
    `type` ENUM('REGISTRATION_QR', 'IMPORT_QR', 'GENERIC') NOT NULL,
    `channel` ENUM('WHATSAPP', 'EMAIL', 'SMS') NOT NULL,
    `locale` ENUM('AR', 'EN') NOT NULL DEFAULT 'AR',
    `name` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationTemplate_eventId_idx`(`eventId`),
    INDEX `NotificationTemplate_type_idx`(`type`),
    INDEX `NotificationTemplate_channel_idx`(`channel`),
    INDEX `NotificationTemplate_locale_idx`(`locale`),
    INDEX `NotificationTemplate_isActive_idx`(`isActive`),
    UNIQUE INDEX `NotificationTemplate_eventId_type_channel_locale_key`(`eventId`, `type`, `channel`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationLog` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NULL,
    `registrationId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `channel` ENUM('WHATSAPP', 'EMAIL', 'SMS') NOT NULL,
    `provider` ENUM('FAKE', 'WASENDER', 'META_CLOUD') NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `subject` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `metadata` JSON NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationLog_eventId_idx`(`eventId`),
    INDEX `NotificationLog_registrationId_idx`(`registrationId`),
    INDEX `NotificationLog_templateId_idx`(`templateId`),
    INDEX `NotificationLog_channel_idx`(`channel`),
    INDEX `NotificationLog_provider_idx`(`provider`),
    INDEX `NotificationLog_recipient_idx`(`recipient`),
    INDEX `NotificationLog_status_idx`(`status`),
    INDEX `NotificationLog_createdAt_idx`(`createdAt`),
    INDEX `NotificationLog_sentAt_idx`(`sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationTemplate` ADD CONSTRAINT `NotificationTemplate_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `NotificationTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
