-- CreateTable
CREATE TABLE `SyncBatch` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `staffSessionId` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'DUPLICATE') NOT NULL DEFAULT 'RECEIVED',
    `totalOperations` INTEGER NOT NULL DEFAULT 0,
    `processedCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `duplicateCount` INTEGER NOT NULL DEFAULT 0,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `payload` JSON NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `checkpointId` VARCHAR(191) NULL,

    UNIQUE INDEX `SyncBatch_batchId_key`(`batchId`),
    INDEX `SyncBatch_eventId_idx`(`eventId`),
    INDEX `SyncBatch_deviceId_idx`(`deviceId`),
    INDEX `SyncBatch_staffSessionId_idx`(`staffSessionId`),
    INDEX `SyncBatch_status_idx`(`status`),
    INDEX `SyncBatch_receivedAt_idx`(`receivedAt`),
    INDEX `SyncBatch_processedAt_idx`(`processedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncOperation` (
    `id` VARCHAR(191) NOT NULL,
    `syncBatchId` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(191) NOT NULL,
    `type` ENUM('OFFLINE_REGISTRATION', 'QR_GENERATION', 'SCAN_EVENT') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'FAILED', 'DUPLICATE', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `input` JSON NOT NULL,
    `output` JSON NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SyncOperation_operationId_key`(`operationId`),
    INDEX `SyncOperation_syncBatchId_idx`(`syncBatchId`),
    INDEX `SyncOperation_operationId_idx`(`operationId`),
    INDEX `SyncOperation_type_idx`(`type`),
    INDEX `SyncOperation_status_idx`(`status`),
    INDEX `SyncOperation_processedAt_idx`(`processedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SyncBatch` ADD CONSTRAINT `SyncBatch_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncBatch` ADD CONSTRAINT `SyncBatch_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncBatch` ADD CONSTRAINT `SyncBatch_staffSessionId_fkey` FOREIGN KEY (`staffSessionId`) REFERENCES `StaffSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncBatch` ADD CONSTRAINT `SyncBatch_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncOperation` ADD CONSTRAINT `SyncOperation_syncBatchId_fkey` FOREIGN KEY (`syncBatchId`) REFERENCES `SyncBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
