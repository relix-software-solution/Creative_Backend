/*
  Warnings:

  - A unique constraint covering the columns `[primaryUserId]` on the table `Client` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Client` ADD COLUMN `primaryUserId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Client_primaryUserId_key` ON `Client`(`primaryUserId`);

-- CreateIndex
CREATE INDEX `Registration_eventId_updatedAt_id_idx` ON `Registration`(`eventId`, `updatedAt`, `id`);

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_primaryUserId_fkey` FOREIGN KEY (`primaryUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
