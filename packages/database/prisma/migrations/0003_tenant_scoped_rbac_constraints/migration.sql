-- Production tenant isolation, identity lifecycle, and commercial metadata.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT 'af-south-1';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "slaAvailabilityTarget" DOUBLE PRECISION NOT NULL DEFAULT 0.995;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "webhookQuota" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "auditRetentionDays" INTEGER NOT NULL DEFAULT 2555;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "completenessScore" DOUBLE PRECISION;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "qualityScore" DOUBLE PRECISION;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "clockQualityScore" DOUBLE PRECISION;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "sourceTrustLevel" TEXT;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "qualityIssues" JSONB;
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "validationProfile" JSONB;

ALTER TYPE "CredentialStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' BEFORE 'ACTIVE';
DO $$ BEGIN
  CREATE TYPE "CredentialKind" AS ENUM ('API_INTEGRATION', 'SERVICE_ACCOUNT', 'DEVICE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "AccountTokenPurpose" AS ENUM ('INVITATION', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ACCOUNT_UNLOCK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);

-- Roles are owned by a tenant and may have the same key in different tenants.
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

INSERT INTO "Tenant" ("id", "name")
SELECT 'tenant-system', 'System'
WHERE NOT EXISTS (SELECT 1 FROM "Tenant") AND EXISTS (SELECT 1 FROM "Role");

UPDATE "Role"
SET "tenantId" = (SELECT "id" FROM "Tenant" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "tenantId" IS NULL;

ALTER TABLE "Role" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_key_key";
DROP INDEX IF EXISTS "Role_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Role_id_tenantId_key" ON "Role"("id", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Role_tenantId_key_key" ON "Role"("tenantId", "key");
ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_tenantId_fkey";
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replicate role definitions and their permissions for every existing tenant.
INSERT INTO "Role" ("id", "tenantId", "key", "name")
SELECT 'role_' || md5(random()::text || clock_timestamp()::text || t."id" || template."key"),
       t."id", template."key", template."name"
FROM "Tenant" t
CROSS JOIN (
  SELECT DISTINCT ON ("key") "key", "name" FROM "Role" ORDER BY "key", "id"
) template
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" existing WHERE existing."tenantId" = t."id" AND existing."key" = template."key"
);

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT DISTINCT 'rp_' || md5(target."id" || source."permissionId"),
       target."id", source."permissionId"
FROM "Role" target
JOIN "Role" template ON template."key" = target."key"
JOIN "RolePermission" source ON source."roleId" = template."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "RolePermission" existing
  WHERE existing."roleId" = target."id" AND existing."permissionId" = source."permissionId"
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Convert legacy user-role rows into tenant membership roles.
ALTER TABLE "UserRole" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "UserRole" ur
SET "tenantId" = COALESCE(
  (SELECT u."tenantId" FROM "User" u WHERE u."id" = ur."userId"),
  (SELECT tm."tenantId" FROM "TenantMembership" tm WHERE tm."userId" = ur."userId" ORDER BY tm."tenantId" LIMIT 1),
  (SELECT r."tenantId" FROM "Role" r WHERE r."id" = ur."roleId")
)
WHERE ur."tenantId" IS NULL;

INSERT INTO "TenantMembership" ("id", "tenantId", "userId")
SELECT 'tm_' || md5(random()::text || clock_timestamp()::text || ur."tenantId" || ur."userId"),
       ur."tenantId", ur."userId"
FROM "UserRole" ur
WHERE ur."tenantId" IS NOT NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;

UPDATE "UserRole" ur
SET "roleId" = tenant_role."id"
FROM "Role" old_role
JOIN "Role" tenant_role ON tenant_role."key" = old_role."key"
WHERE old_role."id" = ur."roleId" AND tenant_role."tenantId" = ur."tenantId";

ALTER TABLE "UserRole" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "UserRole" DROP CONSTRAINT IF EXISTS "UserRole_userId_roleId_key";
DROP INDEX IF EXISTS "UserRole_userId_roleId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UserRole_tenantId_userId_roleId_key"
  ON "UserRole"("tenantId", "userId", "roleId");
ALTER TABLE "UserRole" DROP CONSTRAINT IF EXISTS "UserRole_userId_fkey";
ALTER TABLE "UserRole" DROP CONSTRAINT IF EXISTS "UserRole_roleId_fkey";
ALTER TABLE "UserRole" DROP CONSTRAINT IF EXISTS "UserRole_roleId_tenantId_fkey";
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_tenantId_fkey"
  FOREIGN KEY ("roleId", "tenantId") REFERENCES "Role"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Installation access is valid only for a user membership and an installation in that tenant.
ALTER TABLE "InstallationAccess" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "InstallationAccess" ia
SET "tenantId" = pi."tenantId"
FROM "ProductInstallation" pi
WHERE ia."installationId" = pi."id" AND ia."tenantId" IS NULL;
INSERT INTO "TenantMembership" ("id", "tenantId", "userId")
SELECT 'tm_' || md5(random()::text || clock_timestamp()::text || ia."tenantId" || ia."userId"),
       ia."tenantId", ia."userId"
FROM "InstallationAccess" ia
WHERE ia."tenantId" IS NOT NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;
ALTER TABLE "InstallationAccess" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "InstallationAccess" DROP CONSTRAINT IF EXISTS "InstallationAccess_userId_installationId_key";
DROP INDEX IF EXISTS "InstallationAccess_userId_installationId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "InstallationAccess_tenantId_userId_installationId_key"
  ON "InstallationAccess"("tenantId", "userId", "installationId");
ALTER TABLE "InstallationAccess" DROP CONSTRAINT IF EXISTS "InstallationAccess_userId_fkey";
ALTER TABLE "InstallationAccess" DROP CONSTRAINT IF EXISTS "InstallationAccess_installationId_fkey";
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_installationId_tenantId_fkey"
  FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sessions must also belong to a real tenant membership.
INSERT INTO "TenantMembership" ("id", "tenantId", "userId")
SELECT 'tm_' || md5(random()::text || clock_timestamp()::text || s."tenantId" || s."userId"),
       s."tenantId", s."userId"
FROM "Session" s
ON CONFLICT ("tenantId", "userId") DO NOTHING;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceName" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_tenantId_fkey";
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Session_tenantId_userId_revokedAt_idx" ON "Session"("tenantId", "userId", "revokedAt");

-- Every product/installation-bearing row is protected by a composite tenant key.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductInstallation_id_tenantId_productId_key"
  ON "ProductInstallation"("id", "tenantId", "productId");

UPDATE "TelemetryMessage" tm SET "productId" = pi."productId"
FROM "ProductInstallation" pi
WHERE tm."installationId" = pi."id" AND tm."tenantId" = pi."tenantId" AND tm."productId" <> pi."productId";
ALTER TABLE "TelemetryMessage" DROP CONSTRAINT IF EXISTS "TelemetryMessage_installationId_tenantId_fkey";
ALTER TABLE "TelemetryMessage" ADD CONSTRAINT "TelemetryMessage_installationId_tenantId_productId_fkey"
  FOREIGN KEY ("installationId", "tenantId", "productId") REFERENCES "ProductInstallation"("id", "tenantId", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Recommendation" r SET "productId" = pi."productId"
FROM "ProductInstallation" pi
WHERE r."installationId" = pi."id" AND r."tenantId" = pi."tenantId" AND r."productId" <> pi."productId";
ALTER TABLE "Recommendation" DROP CONSTRAINT IF EXISTS "Recommendation_installationId_tenantId_fkey";
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_installationId_tenantId_productId_fkey"
  FOREIGN KEY ("installationId", "tenantId", "productId") REFERENCES "ProductInstallation"("id", "tenantId", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "ApiCredential" ac SET "productId" = pi."productId"
FROM "ProductInstallation" pi
WHERE ac."installationId" = pi."id" AND ac."tenantId" = pi."tenantId"
  AND ac."productId" IS DISTINCT FROM pi."productId";
ALTER TABLE "ApiCredential" ADD COLUMN IF NOT EXISTS "kind" "CredentialKind" NOT NULL DEFAULT 'API_INTEGRATION';
ALTER TABLE "ApiCredential" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "ApiCredential" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "ApiCredential" DROP CONSTRAINT IF EXISTS "ApiCredential_productId_fkey";
ALTER TABLE "ApiCredential" DROP CONSTRAINT IF EXISTS "ApiCredential_installationId_fkey";
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_productId_tenantId_fkey"
  FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_installationId_tenantId_productId_fkey"
  FOREIGN KEY ("installationId", "tenantId", "productId") REFERENCES "ProductInstallation"("id", "tenantId", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_installation_requires_product"
  CHECK ("installationId" IS NULL OR "productId" IS NOT NULL);
INSERT INTO "TenantMembership" ("id", "tenantId", "userId")
SELECT 'tm_' || md5(random()::text || clock_timestamp()::text || ac."tenantId" || ac."userId"),
       ac."tenantId", ac."userId"
FROM "ApiCredential" ac
WHERE ac."userId" IS NOT NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;
ALTER TABLE "ApiCredential" DROP CONSTRAINT IF EXISTS "ApiCredential_userId_fkey";
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_id_tenantId_key" ON "Asset"("id", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_id_tenantId_installationId_key" ON "Asset"("id", "tenantId", "installationId");
CREATE TABLE IF NOT EXISTS "SensorCalibration" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "measurementKey" TEXT NOT NULL,
  "calibrationData" JSONB NOT NULL,
  "calibratedAt" TIMESTAMP(3) NOT NULL,
  "nextDueAt" TIMESTAMP(3),
  "calibratedBy" TEXT,
  "certificateRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SensorCalibration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SensorCalibration_installationId_tenantId_fkey" FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SensorCalibration_assetId_tenantId_installationId_fkey" FOREIGN KEY ("assetId", "tenantId", "installationId") REFERENCES "Asset"("id", "tenantId", "installationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SensorCalibration_tenantId_installationId_assetId_measurementKey_calibratedAt_idx"
  ON "SensorCalibration"("tenantId", "installationId", "assetId", "measurementKey", "calibratedAt");

CREATE TABLE IF NOT EXISTS "AccountToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "AccountTokenPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AccountToken_userId_purpose_expiresAt_idx" ON "AccountToken"("userId", "purpose", "expiresAt");

ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "artifactUri" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "trainingDatasetVersion" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "featureSetVersion" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "trainingParameters" JSONB;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "trainedAt" TIMESTAMP(3);
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "owner" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "approvalOwner" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "environment" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "rollbackVersion" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "driftStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "explainability" JSONB;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "intendedUse" TEXT;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "limitations" JSONB;
ALTER TABLE "ModelRegistry" ADD COLUMN IF NOT EXISTS "safetyThresholds" JSONB;
ALTER TABLE "ModelRegistry" DROP CONSTRAINT IF EXISTS "ModelRegistry_tenantId_fkey";
ALTER TABLE "ModelRegistry" ADD CONSTRAINT "ModelRegistry_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX IF EXISTS "ModelRegistry_name_version_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ModelRegistry_tenantId_name_version_key"
  ON "ModelRegistry"("tenantId", "name", "version");

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_period_key" ON "Invoice"("tenantId", "period");

CREATE TABLE IF NOT EXISTS "SlaIncident" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SlaIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SlaIncident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Memberships are authoritative after data has been backfilled.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_tenantId_fkey";
ALTER TABLE "User" DROP COLUMN IF EXISTS "tenantId";
