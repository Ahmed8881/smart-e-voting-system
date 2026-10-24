-- CreateTable
CREATE TABLE `Admin` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `role` ENUM('ADMIN', 'VOTER') NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Admin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Voter` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `cnic` CHAR(15) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'SUSPENDED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `approvedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Voter_email_key`(`email`),
    UNIQUE INDEX `Voter_cnic_key`(`cnic`),
    INDEX `Voter_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FaceTemplate` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NOT NULL,
    `embeddingCiphertext` BLOB NOT NULL,
    `iv` BINARY(12) NOT NULL,
    `authTag` BINARY(16) NOT NULL,
    `modelVersion` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FaceTemplate_voterId_key`(`voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebAuthnCredential` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NOT NULL,
    `credentialId` VARCHAR(512) NOT NULL,
    `publicKey` BLOB NOT NULL,
    `signCount` INTEGER UNSIGNED NOT NULL,
    `transports` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `WebAuthnCredential_credentialId_key`(`credentialId`),
    INDEX `WebAuthnCredential_voterId_idx`(`voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Election` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Election_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Candidate` (
    `id` CHAR(36) NOT NULL,
    `electionId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `party` VARCHAR(120) NOT NULL,
    `symbolUrl` VARCHAR(500) NULL,
    `createdById` CHAR(36) NOT NULL,

    INDEX `Candidate_electionId_idx`(`electionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Participation` (
    `voterId` CHAR(36) NOT NULL,
    `electionId` CHAR(36) NOT NULL,
    `votedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Participation_electionId_idx`(`electionId`),
    PRIMARY KEY (`voterId`, `electionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ballot` (
    `id` CHAR(36) NOT NULL,
    `electionId` CHAR(36) NOT NULL,
    `candidateId` CHAR(36) NOT NULL,

    INDEX `Ballot_electionId_candidateId_idx`(`electionId`, `candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultTally` (
    `electionId` CHAR(36) NOT NULL,
    `candidateId` CHAR(36) NOT NULL,
    `voteCount` INTEGER UNSIGNED NOT NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`electionId`, `candidateId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthEvent` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NULL,
    `cnicAttempted` CHAR(15) NULL,
    `type` VARCHAR(40) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `userAgent` VARCHAR(500) NOT NULL,
    `deviceHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthEvent_cnicAttempted_createdAt_idx`(`cnicAttempted`, `createdAt`),
    INDEX `AuthEvent_deviceHash_createdAt_idx`(`deviceHash`, `createdAt`),
    INDEX `AuthEvent_ip_createdAt_idx`(`ip`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FraudAlert` (
    `id` CHAR(36) NOT NULL,
    `voterId` CHAR(36) NULL,
    `electionId` CHAR(36) NULL,
    `type` VARCHAR(60) NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `score` DOUBLE NULL,
    `description` VARCHAR(500) NOT NULL,
    `details` JSON NOT NULL,
    `status` ENUM('OPEN', 'REVIEWED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,

    INDEX `FraudAlert_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorType` VARCHAR(20) NOT NULL,
    `actorId` VARCHAR(64) NULL,
    `action` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `prevHash` CHAR(64) NOT NULL,
    `hash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuditLog_hash_key`(`hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditChainHead` (
    `id` INTEGER NOT NULL,
    `lastHash` CHAR(64) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(80) NOT NULL,
    `value` VARCHAR(500) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `role` ENUM('ADMIN', 'VOTER') NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_role_subjectId_idx`(`role`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminOtp` (
    `id` CHAR(36) NOT NULL,
    `adminId` CHAR(36) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminOtp_adminId_idx`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Voter` ADD CONSTRAINT `Voter_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FaceTemplate` ADD CONSTRAINT `FaceTemplate_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `Voter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebAuthnCredential` ADD CONSTRAINT `WebAuthnCredential_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `Voter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Election` ADD CONSTRAINT `Election_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Candidate` ADD CONSTRAINT `Candidate_electionId_fkey` FOREIGN KEY (`electionId`) REFERENCES `Election`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Candidate` ADD CONSTRAINT `Candidate_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Participation` ADD CONSTRAINT `Participation_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `Voter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Participation` ADD CONSTRAINT `Participation_electionId_fkey` FOREIGN KEY (`electionId`) REFERENCES `Election`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ballot` ADD CONSTRAINT `Ballot_electionId_fkey` FOREIGN KEY (`electionId`) REFERENCES `Election`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ballot` ADD CONSTRAINT `Ballot_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultTally` ADD CONSTRAINT `ResultTally_electionId_fkey` FOREIGN KEY (`electionId`) REFERENCES `Election`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultTally` ADD CONSTRAINT `ResultTally_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthEvent` ADD CONSTRAINT `AuthEvent_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `Voter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FraudAlert` ADD CONSTRAINT `FraudAlert_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `Voter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FraudAlert` ADD CONSTRAINT `FraudAlert_electionId_fkey` FOREIGN KEY (`electionId`) REFERENCES `Election`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FraudAlert` ADD CONSTRAINT `FraudAlert_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminOtp` ADD CONSTRAINT `AdminOtp_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Genesis of the audit hash chain: the first entry's prevHash is 64 zeros.
INSERT INTO `AuditChainHead` (`id`, `lastHash`) VALUES (1, REPEAT('0', 64));
