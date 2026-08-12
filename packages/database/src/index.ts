export { prisma } from "./client.js";
export {
  ensureInstallationIdentity,
  resolveInstallationIdentity,
  resolveProductIdentity,
  assertTenantOwns
} from "./repositories/installations.js";
export { saveTelemetryEnvelope, listTelemetryForInstallation } from "./repositories/telemetry.js";
export {
  saveRecommendations,
  listRecommendations,
  updateRecommendationStatus,
  recordRecommendationFeedback
} from "./repositories/recommendations.js";
export { writeAuditEvent, listAuditEvents } from "./repositories/audit.js";
export { resolveApiCredential, createApiCredential, listApiCredentials, revokeApiCredential, rotateApiCredential } from "./repositories/credentials.js";
export { listActiveWebhooks, recordWebhookDelivery, markWebhookResult, createWebhookEndpoint, listWebhookEndpoints, listWebhookDeliveries } from "./repositories/webhooks.js";
export { authenticateUser, resolveSession, revokeSession, inviteUser, listTenantUsers } from "./repositories/users.js";
export { listInstallations, listDevices, listAssets, recordUsage, archiveExpiredRecommendations } from "./repositories/fleet.js";
