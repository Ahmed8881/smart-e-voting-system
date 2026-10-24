-- CreateTable
CREATE TABLE `WebAuthnChallenge` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NOT NULL,
    `challenge` VARCHAR(128) NOT NULL,
    `ceremony` ENUM('REGISTRATION', 'AUTHENTICATION') NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebAuthnChallenge_voterId_ceremony_createdAt_idx`(`voterId`, `ceremony`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryRequest` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `decidedById` CHAR(36) NULL,

    INDEX `RecoveryRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `RecoveryRequest_voterId_idx`(`voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
