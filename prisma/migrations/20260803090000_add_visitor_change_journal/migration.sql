-- Durable visitor-change journal used by realtime and delta synchronization.
CREATE TABLE `VisitorChange` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `eventId` VARCHAR(191) NOT NULL,
  `registrationId` VARCHAR(191) NOT NULL,
  `operation` VARCHAR(16) NOT NULL,
  `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `VisitorChange_eventId_id_idx` (`eventId`, `id`),
  INDEX `VisitorChange_eventId_changedAt_idx` (`eventId`, `changedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill every existing registration. This is required for devices that
-- already have an older/incomplete IndexedDB snapshot: their first delta sync
-- will repair the local stock without downloading the whole snapshot again.
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
SELECT `eventId`, `id`, 'UPSERT', CURRENT_TIMESTAMP(3)
FROM `Registration`
ORDER BY `createdAt` ASC, `id` ASC;

-- Every registration creation becomes an UPSERT change.
CREATE TRIGGER `registration_visitor_change_after_insert`
AFTER INSERT ON `Registration`
FOR EACH ROW
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
VALUES (NEW.`eventId`, NEW.`id`, 'UPSERT', CURRENT_TIMESTAMP(3));

-- Only visitor-facing registration changes create an UPSERT journal row.
CREATE TRIGGER `registration_visitor_change_after_update`
AFTER UPDATE ON `Registration`
FOR EACH ROW
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
SELECT NEW.`eventId`, NEW.`id`, 'UPSERT', CURRENT_TIMESTAMP(3)
WHERE
  NOT (OLD.`eventId` <=> NEW.`eventId`) OR
  NOT (OLD.`attendeeTypeId` <=> NEW.`attendeeTypeId`) OR
  NOT (OLD.`status` <=> NEW.`status`) OR
  NOT (OLD.`source` <=> NEW.`source`) OR
  NOT (OLD.`fullName` <=> NEW.`fullName`) OR
  NOT (OLD.`phone` <=> NEW.`phone`) OR
  NOT (OLD.`email` <=> NEW.`email`) OR
  NOT (OLD.`companyName` <=> NEW.`companyName`) OR
  NOT (OLD.`jobTitle` <=> NEW.`jobTitle`) OR
  NOT (OLD.`externalId` <=> NEW.`externalId`) OR
  NOT (OLD.`customFields` <=> NEW.`customFields`) OR
  NOT (OLD.`notes` <=> NEW.`notes`) OR
  NOT (OLD.`registeredAt` <=> NEW.`registeredAt`) OR
  NOT (OLD.`syncedAt` <=> NEW.`syncedAt`);

-- Keep deletion tombstones so disconnected scanners can remove stale visitors.
CREATE TRIGGER `registration_visitor_change_after_delete`
AFTER DELETE ON `Registration`
FOR EACH ROW
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
VALUES (OLD.`eventId`, OLD.`id`, 'DELETE', CURRENT_TIMESTAMP(3));

-- QR creation/rotation/revocation also refreshes the cached visitor so the
-- scanner receives the canonical compact token immediately.
CREATE TRIGGER `qr_token_visitor_change_after_insert`
AFTER INSERT ON `QrToken`
FOR EACH ROW
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
VALUES (NEW.`eventId`, NEW.`registrationId`, 'UPSERT', CURRENT_TIMESTAMP(3));

CREATE TRIGGER `qr_token_visitor_change_after_update`
AFTER UPDATE ON `QrToken`
FOR EACH ROW
INSERT INTO `VisitorChange` (`eventId`, `registrationId`, `operation`, `changedAt`)
SELECT NEW.`eventId`, NEW.`registrationId`, 'UPSERT', CURRENT_TIMESTAMP(3)
WHERE
  NOT (OLD.`tokenId` <=> NEW.`tokenId`) OR
  NOT (OLD.`status` <=> NEW.`status`) OR
  NOT (OLD.`validFrom` <=> NEW.`validFrom`) OR
  NOT (OLD.`validUntil` <=> NEW.`validUntil`) OR
  NOT (OLD.`revokedAt` <=> NEW.`revokedAt`);
