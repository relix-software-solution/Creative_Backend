-- CreateTable
CREATE TABLE `ImportJob` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `attendeeTypeId` VARCHAR(191) NULL,
    `uploadedByUserId` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileMimeType` VARCHAR(191) NULL,
    `fileSizeBytes` INTEGER NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `processedRows` INTEGER NOT NULL DEFAULT 0,
    `successRows` INTEGER NOT NULL DEFAULT 0,
    `failedRows` INTEGER NOT NULL DEFAULT 0,
    `duplicateRows` INTEGER NOT NULL DEFAULT 0,
    `options` JSON NULL,
    `summary` JSON NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportJob_eventId_idx`(`eventId`),
    INDEX `ImportJob_attendeeTypeId_idx`(`attendeeTypeId`),
    INDEX `ImportJob_uploadedByUserId_idx`(`uploadedByUserId`),
    INDEX `ImportJob_status_idx`(`status`),
    INDEX `ImportJob_createdAt_idx`(`createdAt`),
    INDEX `ImportJob_completedAt_idx`(`completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportRow` (
    `id` VARCHAR(191) NOT NULL,
    `importJobId` VARCHAR(191) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'FAILED', 'DUPLICATE', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `rawData` JSON NOT NULL,
    `normalizedData` JSON NULL,
    `registrationId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportRow_importJobId_idx`(`importJobId`),
    INDEX `ImportRow_status_idx`(`status`),
    INDEX `ImportRow_registrationId_idx`(`registrationId`),
    INDEX `ImportRow_rowNumber_idx`(`rowNumber`),
    INDEX `ImportRow_processedAt_idx`(`processedAt`),
    UNIQUE INDEX `ImportRow_importJobId_rowNumber_key`(`importJobId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImportJob` ADD CONSTRAINT `ImportJob_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportJob` ADD CONSTRAINT `ImportJob_attendeeTypeId_fkey` FOREIGN KEY (`attendeeTypeId`) REFERENCES `AttendeeType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportJob` ADD CONSTRAINT `ImportJob_uploadedByUserId_fkey` FOREIGN KEY (`uploadedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportRow` ADD CONSTRAINT `ImportRow_importJobId_fkey` FOREIGN KEY (`importJobId`) REFERENCES `ImportJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportRow` ADD CONSTRAINT `ImportRow_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
