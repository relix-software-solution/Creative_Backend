-- AlterTable
ALTER TABLE `Registration` ADD COLUMN `ticketRequestClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `ticketRequestPhone` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Registration_ticketRequestPhone_idx` ON `Registration`(`ticketRequestPhone`);
