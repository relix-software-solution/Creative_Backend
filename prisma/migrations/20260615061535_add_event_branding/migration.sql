-- CreateTable
CREATE TABLE `EventBranding` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `logoUrl` VARCHAR(191) NULL,
    `backgroundImageUrl` VARCHAR(191) NULL,
    `theme` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EventBranding_eventId_key`(`eventId`),
    INDEX `EventBranding_isActive_idx`(`isActive`),
    INDEX `EventBranding_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventBranding` ADD CONSTRAINT `EventBranding_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
