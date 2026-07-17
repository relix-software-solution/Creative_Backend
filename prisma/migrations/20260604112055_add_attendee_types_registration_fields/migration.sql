-- CreateTable
CREATE TABLE `AttendeeType` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NULL,
    `descriptionAr` TEXT NULL,
    `descriptionEn` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AttendeeType_eventId_idx`(`eventId`),
    INDEX `AttendeeType_code_idx`(`code`),
    INDEX `AttendeeType_isActive_idx`(`isActive`),
    INDEX `AttendeeType_sortOrder_idx`(`sortOrder`),
    UNIQUE INDEX `AttendeeType_eventId_code_key`(`eventId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegistrationField` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `attendeeTypeId` VARCHAR(191) NULL,
    `key` VARCHAR(191) NOT NULL,
    `labelAr` VARCHAR(191) NOT NULL,
    `labelEn` VARCHAR(191) NULL,
    `type` ENUM('TEXT', 'TEXTAREA', 'NUMBER', 'EMAIL', 'PHONE', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'FILE') NOT NULL,
    `placeholderAr` VARCHAR(191) NULL,
    `placeholderEn` VARCHAR(191) NULL,
    `helpTextAr` TEXT NULL,
    `helpTextEn` TEXT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `isUnique` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NULL,
    `validation` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RegistrationField_eventId_idx`(`eventId`),
    INDEX `RegistrationField_attendeeTypeId_idx`(`attendeeTypeId`),
    INDEX `RegistrationField_key_idx`(`key`),
    INDEX `RegistrationField_type_idx`(`type`),
    INDEX `RegistrationField_isRequired_idx`(`isRequired`),
    INDEX `RegistrationField_isActive_idx`(`isActive`),
    INDEX `RegistrationField_sortOrder_idx`(`sortOrder`),
    UNIQUE INDEX `RegistrationField_eventId_key_attendeeTypeId_key`(`eventId`, `key`, `attendeeTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AttendeeType` ADD CONSTRAINT `AttendeeType_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegistrationField` ADD CONSTRAINT `RegistrationField_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegistrationField` ADD CONSTRAINT `RegistrationField_attendeeTypeId_fkey` FOREIGN KEY (`attendeeTypeId`) REFERENCES `AttendeeType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
