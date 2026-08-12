-- Enums
CREATE TYPE "InstallationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMMISSIONING', 'DECOMMISSIONED', 'ARCHIVED');
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN', 'ARCHIVED');
CREATE TYPE "RecommendationSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RecommendationStatusEnum" AS ENUM ('PROPOSED', 'ACKNOWLEDGED', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'RESOLVED');
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'API', 'SYSTEM', 'DEVICE', 'SERVICE_ACCOUNT');
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'DISABLED', 'FAILING');
CREATE TYPE "IdentityKind" AS ENUM ('USER', 'SERVICE_ACCOUNT', 'DEVICE', 'API_INTEGRATION');
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ROTATED');

-- Tenant commercial / retention fields
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'pilot';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "telemetryRetentionDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "recommendationRetentionDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ingestQuotaPerMinute" INTEGER NOT NULL DEFAULT 600;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Installation / device / asset integrity
ALTER TABLE "ProductInstallation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProductInstallation" ALTER COLUMN "status" TYPE "InstallationStatus" USING ("status"::"InstallationStatus");
ALTER TABLE "ProductInstallation" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "ProductInstallation" ADD COLUMN IF NOT EXISTS "topology" JSONB;
ALTER TABLE "ProductInstallation" ADD COLUMN IF NOT EXISTS "capacityKw" DOUBLE PRECISION;
ALTER TABLE "ProductInstallation" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "status" "DeviceStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "firmwareVersion" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSequence" INTEGER;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Telemetry quality / lifecycle
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "sequenceNumber" INTEGER;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "stale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "delayed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "outOfOrder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "simulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT NOT NULL DEFAULT '1.0';
ALTER TABLE "TelemetryMessage" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Recommendation enums and decision audit
ALTER TABLE "Recommendation" ALTER COLUMN "severity" TYPE "RecommendationSeverity" USING ("severity"::"RecommendationSeverity");
ALTER TABLE "Recommendation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Recommendation" ALTER COLUMN "status" TYPE "RecommendationStatusEnum" USING ("status"::"RecommendationStatusEnum");
ALTER TABLE "Recommendation" ALTER COLUMN "status" SET DEFAULT 'PROPOSED';
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "modelVersion" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "expectedEnergyKwh" DOUBLE PRECISION;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "expectedRevenue" DOUBLE PRECISION;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "expectedCarbonKg" DOUBLE PRECISION;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "actionDeadline" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "safetyClass" TEXT NOT NULL DEFAULT 'advisory';
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "useful" BOOLEAN;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "correct" BOOLEAN;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "decisionActorId" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "decisionComment" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "supersededById" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Recommendation_tenantId_skillId_status_idx" ON "Recommendation"("tenantId", "skillId", "status");

-- Audit actor enum
ALTER TABLE "AuditEvent" ALTER COLUMN "actorType" TYPE "AuditActorType" USING (
  CASE
    WHEN "actorType" IN ('USER', 'API', 'SYSTEM', 'DEVICE', 'SERVICE_ACCOUNT') THEN "actorType"::"AuditActorType"
    ELSE 'SYSTEM'::"AuditActorType"
  END
);

-- Composite uniqueness used by tenant-ownership foreign keys
CREATE UNIQUE INDEX IF NOT EXISTS "Product_id_tenantId_key" ON "Product"("id", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductInstallation_id_tenantId_key" ON "ProductInstallation"("id", "tenantId");

ALTER TABLE "ProductInstallation" DROP CONSTRAINT IF EXISTS "ProductInstallation_productId_fkey";
ALTER TABLE "ProductInstallation" ADD CONSTRAINT "ProductInstallation_productId_tenantId_fkey"
  FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_installationId_fkey";
ALTER TABLE "Device" ADD CONSTRAINT "Device_installationId_tenantId_fkey"
  FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_installationId_fkey";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_installationId_tenantId_fkey"
  FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TelemetryMessage" DROP CONSTRAINT IF EXISTS "TelemetryMessage_installationId_fkey";
ALTER TABLE "TelemetryMessage" ADD CONSTRAINT "TelemetryMessage_installationId_tenantId_fkey"
  FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Recommendation" DROP CONSTRAINT IF EXISTS "Recommendation_installationId_fkey";
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_installationId_tenantId_fkey"
  FOREIGN KEY ("installationId", "tenantId") REFERENCES "ProductInstallation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Identity, RBAC, credentials, webhooks, metering, models
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "kind" "IdentityKind" NOT NULL DEFAULT 'USER',
    "lockedUntil" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InstallationAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    CONSTRAINT "InstallationAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstallationAccess_userId_installationId_key" ON "InstallationAccess"("userId", "installationId");
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "ProductInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "installationId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "signingSecretEnc" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApiCredential_tenantId_keyPrefix_idx" ON "ApiCredential"("tenantId", "keyPrefix");
CREATE INDEX "ApiCredential_tenantId_status_idx" ON "ApiCredential"("tenantId", "status");
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "ProductInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_idempotencyId_key" ON "WebhookDelivery"("endpointId", "idempotencyId");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UsageMeter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,
    CONSTRAINT "UsageMeter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UsageMeter_tenantId_metric_period_key" ON "UsageMeter"("tenantId", "metric", "period");
ALTER TABLE "UsageMeter" ADD CONSTRAINT "UsageMeter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "metadata" JSONB,
    "evaluation" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModelRegistry_name_version_key" ON "ModelRegistry"("name", "version");
