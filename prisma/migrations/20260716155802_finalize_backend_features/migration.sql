/*
  Warnings:

  - A unique constraint covering the columns `[ticketRequestToken]` on the table `Registration` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Registration` ADD COLUMN `ticketRequestConsumedAt` DATETIME(3) NULL,
    ADD COLUMN `ticketRequestCreatedAt` DATETIME(3) NULL,
    ADD COLUMN `ticketRequestExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `ticketRequestToken` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `WebhookDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `deliveryId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WebhookDelivery_deliveryId_key`(`deliveryId`),
    INDEX `WebhookDelivery_provider_idx`(`provider`),
    INDEX `WebhookDelivery_status_idx`(`status`),
    INDEX `WebhookDelivery_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Registration_ticketRequestToken_key` ON `Registration`(`ticketRequestToken`);

-- CreateIndex
CREATE INDEX `Registration_ticketRequestToken_idx` ON `Registration`(`ticketRequestToken`);

-- CreateIndex
CREATE INDEX `Registration_ticketRequestExpiresAt_idx` ON `Registration`(`ticketRequestExpiresAt`);
