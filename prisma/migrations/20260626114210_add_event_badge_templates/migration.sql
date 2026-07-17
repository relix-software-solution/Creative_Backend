-- CreateTable
CREATE TABLE `EventBadgeTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `widthMm` INTEGER NOT NULL,
    `heightMm` INTEGER NOT NULL,
    `backgroundImageUrl` VARCHAR(191) NULL,
    `colors` JSON NOT NULL,
    `layout` JSON NOT NULL,
    `selectedFields` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EventBadgeTemplate_eventId_key`(`eventId`),
    INDEX `EventBadgeTemplate_isActive_idx`(`isActive`),
    INDEX `EventBadgeTemplate_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventBadgeTemplate` ADD CONSTRAINT `EventBadgeTemplate_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
