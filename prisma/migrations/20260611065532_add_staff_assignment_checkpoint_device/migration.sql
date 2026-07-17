-- AlterTable
ALTER TABLE `StaffAssignment` ADD COLUMN `checkpointId` VARCHAR(191) NULL,
    ADD COLUMN `deviceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `StaffAssignment_checkpointId_idx` ON `StaffAssignment`(`checkpointId`);

-- CreateIndex
CREATE INDEX `StaffAssignment_deviceId_idx` ON `StaffAssignment`(`deviceId`);

-- AddForeignKey
ALTER TABLE `StaffAssignment` ADD CONSTRAINT `StaffAssignment_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `Checkpoint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffAssignment` ADD CONSTRAINT `StaffAssignment_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
