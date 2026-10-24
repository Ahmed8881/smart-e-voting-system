-- CreateTable
CREATE TABLE `LivenessChallenge` (
    `nonce` VARCHAR(64) NOT NULL,
    `purpose` ENUM('REGISTRATION', 'LOGIN', 'RECOVERY') NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`nonce`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
