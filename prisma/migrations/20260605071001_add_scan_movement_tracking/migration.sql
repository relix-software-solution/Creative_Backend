-- CreateTable
CREATE TABLE `ScanEventRaw` (
    `id` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `staffSessionId` VARCHAR(191) NULL,
    `checkpointId` VARCHAR(191) NULL,
    `registrationId` VARCHAR(191) NULL,
    `qrTokenId` VARCHAR(191) NULL,
    `qrPayload` JSON NULL,
    `qrRaw` TEXT NULL,
    `type` ENUM('ENTRY', 'EXIT', 'CHECKPOINT', 'BOOTH_VISIT', 'SESSION_ATTENDANCE', 'VIP_ACCESS') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'DUPLICATE', 'FAILED', 'INVALID_QR') NOT NULL DEFAULT 'PENDING',
    `result` ENUM('ALLOWED', 'DENIED', 'WARNING') NULL,
    `reason` VARCHAR(191) NULL,
    `scannedAtDevice` DATETIME(3) NOT NULL,
    `receivedAtServer` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ScanEventRaw_operationId_key`(`operationId`),
    INDEX `ScanEventRaw_eventId_idx`(`eventId`),
    INDEX `ScanEventRaw_deviceId_idx`(`deviceId`),
    INDEX `ScanEventRaw_staffSessionId_idx`(`staffSessionId`),
    INDEX `ScanEventRaw_checkpointId_idx`(`checkpointId`),
    INDEX `ScanEventRaw_registrationId_idx`(`registrationId`),
    INDEX `ScanEventRaw_qrTokenId_idx`(`qrTokenId`),
    INDEX `ScanEventRaw_status_idx`(`status`),
    INDEX `ScanEventRaw_type_idx`(`type`),
    INDEX `ScanEventRaw_scannedAtDevice_idx`(`scannedAtDevice`),
    INDEX `ScanEventRaw_receivedAtServer_idx`(`receivedAtServer`),
    INDEX `ScanEventRaw_processedAt_idx`(`processedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MovementLog` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `qrTokenId` VARCHAR(191) NULL,
    `scanEventRawId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `staffSessionId` VARCHAR(191) NULL,
    `checkpointId` VARCHAR(191) NULL,
    `type` ENUM('ENTRY', 'EXIT', 'CHECKPOINT', 'BOOTH_VISIT', 'SESSION_ATTENDANCE', 'VIP_ACCESS') NOT NULL,
    `result` ENUM('ALLOWED', 'DENIED', 'WARNING') NOT NULL,
    `reason` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MovementLog_scanEventRawId_key`(`scanEventRawId`),
    INDEX `MovementLog_eventId_idx`(`eventId`),
    INDEX `MovementLog_registrationId_idx`(`registrationId`),
    INDEX `MovementLog_qrTokenId_idx`(`qrTokenId`),
    INDEX `MovementLog_deviceId_idx`(`deviceId`),
    INDEX `MovementLog_staffSessionId_idx`(`staffSessionId`),
    INDEX `MovementLog_checkpointId_idx`(`checkpointId`),
    INDEX `MovementLog_type_idx`(`type`),
    INDEX `MovementLog_result_idx`(`result`),
    INDEX `MovementLog_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_staffSessionId_fkey` FOREIGN KEY (`staffSessionId`) REFERENCES `StaffSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScanEventRaw` ADD CONSTRAINT `ScanEventRaw_qrTokenId_fkey` FOREIGN KEY (`qrTokenId`) REFERENCES `QrToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_qrTokenId_fkey` FOREIGN KEY (`qrTokenId`) REFERENCES `QrToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_scanEventRawId_fkey` FOREIGN KEY (`scanEventRawId`) REFERENCES `ScanEventRaw`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_staffSessionId_fkey` FOREIGN KEY (`staffSessionId`) REFERENCES `StaffSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovementLog` ADD CONSTRAINT `MovementLog_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
