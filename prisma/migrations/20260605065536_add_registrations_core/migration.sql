-- CreateTable
CREATE TABLE `StaffAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StaffAssignment_eventId_idx`(`eventId`),
    INDEX `StaffAssignment_userId_idx`(`userId`),
    INDEX `StaffAssignment_isActive_idx`(`isActive`),
    UNIQUE INDEX `StaffAssignment_eventId_userId_key`(`eventId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffSession` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `staffUserId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `checkpointId` VARCHAR(191) NOT NULL,
    `mode` ENUM('ENTRY', 'EXIT', 'CHECKPOINT', 'BOOTH_VISIT', 'SESSION_ATTENDANCE', 'VIP_ACCESS') NOT NULL,
    `status` ENUM('ACTIVE', 'ENDED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StaffSession_eventId_idx`(`eventId`),
    INDEX `StaffSession_staffUserId_idx`(`staffUserId`),
    INDEX `StaffSession_deviceId_idx`(`deviceId`),
    INDEX `StaffSession_checkpointId_idx`(`checkpointId`),
    INDEX `StaffSession_status_idx`(`status`),
    INDEX `StaffSession_startedAt_idx`(`startedAt`),
    INDEX `StaffSession_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Registration` (
    `id` VARCHAR(191) NOT NULL,
    `publicId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `attendeeTypeId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'CANCELLED', 'BLOCKED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `source` ENUM('ONLINE', 'ONSITE', 'EXCEL_IMPORT', 'OFFLINE_DEVICE', 'ADMIN') NOT NULL DEFAULT 'ADMIN',
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `companyName` VARCHAR(191) NULL,
    `jobTitle` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,
    `customFields` JSON NULL,
    `notes` TEXT NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Registration_publicId_key`(`publicId`),
    INDEX `Registration_eventId_idx`(`eventId`),
    INDEX `Registration_attendeeTypeId_idx`(`attendeeTypeId`),
    INDEX `Registration_status_idx`(`status`),
    INDEX `Registration_source_idx`(`source`),
    INDEX `Registration_phone_idx`(`phone`),
    INDEX `Registration_email_idx`(`email`),
    INDEX `Registration_externalId_idx`(`externalId`),
    INDEX `Registration_registeredAt_idx`(`registeredAt`),
    INDEX `Registration_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `Registration_eventId_phone_key`(`eventId`, `phone`),
    UNIQUE INDEX `Registration_eventId_email_key`(`eventId`, `email`),
    UNIQUE INDEX `Registration_eventId_externalId_key`(`eventId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StaffAssignment` ADD CONSTRAINT `StaffAssignment_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffAssignment` ADD CONSTRAINT `StaffAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffSession` ADD CONSTRAINT `StaffSession_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffSession` ADD CONSTRAINT `StaffSession_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffSession` ADD CONSTRAINT `StaffSession_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffSession` ADD CONSTRAINT `StaffSession_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Registration` ADD CONSTRAINT `Registration_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Registration` ADD CONSTRAINT `Registration_attendeeTypeId_fkey` FOREIGN KEY (`attendeeTypeId`) REFERENCES `AttendeeType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
