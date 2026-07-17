-- CreateTable
CREATE TABLE `QrToken` (
    `id` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `signature` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `validFrom` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QrToken_registrationId_key`(`registrationId`),
    UNIQUE INDEX `QrToken_tokenId_key`(`tokenId`),
    INDEX `QrToken_eventId_idx`(`eventId`),
    INDEX `QrToken_tokenId_idx`(`tokenId`),
    INDEX `QrToken_status_idx`(`status`),
    INDEX `QrToken_validFrom_idx`(`validFrom`),
    INDEX `QrToken_validUntil_idx`(`validUntil`),
    INDEX `QrToken_generatedAt_idx`(`generatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `QrToken` ADD CONSTRAINT `QrToken_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrToken` ADD CONSTRAINT `QrToken_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
