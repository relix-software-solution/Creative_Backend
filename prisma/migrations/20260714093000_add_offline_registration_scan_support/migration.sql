-- CreateEnum
ALTER TABLE `SyncOperation` MODIFY `type` ENUM('OFFLINE_REGISTRATION', 'OFFLINE_SCAN', 'QR_GENERATION', 'SCAN_EVENT') NOT NULL;

-- CreateTable
CREATE TABLE `DeviceOfflineKey` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `publicKey` TEXT NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED', 'ROTATED') NOT NULL DEFAULT 'ACTIVE',
    `validFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validUntil` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeviceOfflineKey_deviceId_version_key`(`deviceId`, `version`),
    INDEX `DeviceOfflineKey_deviceId_idx`(`deviceId`),
    INDEX `DeviceOfflineKey_status_idx`(`status`),
    INDEX `DeviceOfflineKey_validFrom_idx`(`validFrom`),
    INDEX `DeviceOfflineKey_validUntil_idx`(`validUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfflineRegistrationMapping` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `issuerDeviceId` VARCHAR(191) NOT NULL,
    `offlineRegistrationOperationId` VARCHAR(191) NOT NULL,
    `offlineRegistrationId` VARCHAR(191) NOT NULL,
    `offlineQrToken` VARCHAR(191) NOT NULL,
    `issuerKeyVersion` INTEGER NOT NULL,
    `payloadHash` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NULL,
    `canonicalQrTokenId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'SYNCED', 'MATCHED_EXISTING', 'CONFLICTED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `conflictCode` VARCHAR(191) NULL,
    `conflictMessage` TEXT NULL,
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OfflineRegistrationMapping_offlineQrToken_key`(`offlineQrToken`),
    UNIQUE INDEX `OfflineRegMapping_issuer_op_key`(`issuerDeviceId`, `eventId`, `offlineRegistrationOperationId`),
    UNIQUE INDEX `OfflineRegMapping_issuer_local_key`(`issuerDeviceId`, `eventId`, `offlineRegistrationId`),
    INDEX `OfflineRegistrationMapping_registrationId_idx`(`registrationId`),
    INDEX `OfflineRegistrationMapping_eventId_idx`(`eventId`),
    INDEX `OfflineRegistrationMapping_offlineQrToken_idx`(`offlineQrToken`),
    INDEX `OfflineRegistrationMapping_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfflineScanOperation` (
    `id` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `scannerDeviceId` VARCHAR(191) NOT NULL,
    `checkpointId` VARCHAR(191) NOT NULL,
    `staffSessionId` VARCHAR(191) NULL,
    `offlineQrToken` VARCHAR(191) NOT NULL,
    `offlineRegistrationOperationId` VARCHAR(191) NULL,
    `issuerDeviceId` VARCHAR(191) NULL,
    `issuerKeyVersion` INTEGER NULL,
    `scannedAtDevice` DATETIME(3) NOT NULL,
    `movementType` ENUM('ENTRY', 'EXIT', 'CHECKPOINT', 'BOOTH_VISIT', 'SESSION_ATTENDANCE', 'VIP_ACCESS') NOT NULL,
    `localResult` VARCHAR(191) NULL,
    `qrPayload` JSON NULL,
    `qrPayloadHash` VARCHAR(191) NULL,
    `status` ENUM('PENDING_LINK', 'LINKED', 'PROCESSED', 'CONFLICTED', 'FAILED') NOT NULL DEFAULT 'PENDING_LINK',
    `registrationId` VARCHAR(191) NULL,
    `movementId` VARCHAR(191) NULL,
    `scanEventRawId` VARCHAR(191) NULL,
    `conflictCode` VARCHAR(191) NULL,
    `conflictMessage` TEXT NULL,
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OfflineScanOperation_operationId_key`(`operationId`),
    UNIQUE INDEX `OfflineScanOperation_movementId_key`(`movementId`),
    UNIQUE INDEX `OfflineScanOperation_scanEventRawId_key`(`scanEventRawId`),
    INDEX `OfflineScanOperation_eventId_idx`(`eventId`),
    INDEX `OfflineScanOperation_offlineQrToken_idx`(`offlineQrToken`),
    INDEX `OfflineScanOperation_registrationId_idx`(`registrationId`),
    INDEX `OfflineScanOperation_scannerDeviceId_idx`(`scannerDeviceId`),
    INDEX `OfflineScanOperation_status_idx`(`status`),
    INDEX `OfflineScanOperation_scannedAtDevice_idx`(`scannedAtDevice`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DeviceOfflineKey` ADD CONSTRAINT `DeviceOfflineKey_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineRegistrationMapping` ADD CONSTRAINT `OfflineRegistrationMapping_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineRegistrationMapping` ADD CONSTRAINT `OfflineRegistrationMapping_issuerDeviceId_fkey` FOREIGN KEY (`issuerDeviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineRegistrationMapping` ADD CONSTRAINT `OfflineRegistrationMapping_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `OfflineRegistrationMapping` ADD CONSTRAINT `OfflineRegistrationMapping_canonicalQrTokenId_fkey` FOREIGN KEY (`canonicalQrTokenId`) REFERENCES `QrToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_scannerDeviceId_fkey` FOREIGN KEY (`scannerDeviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_staffSessionId_fkey` FOREIGN KEY (`staffSessionId`) REFERENCES `StaffSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_movementId_fkey` FOREIGN KEY (`movementId`) REFERENCES `MovementLog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `OfflineScanOperation` ADD CONSTRAINT `OfflineScanOperation_scanEventRawId_fkey` FOREIGN KEY (`scanEventRawId`) REFERENCES `ScanEventRaw`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
