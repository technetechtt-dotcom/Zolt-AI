import type { PermissionKey } from "@zolt/contracts";

export interface AuthenticatedPrincipal {
  tenantId: string;
  productId?: string;
  installationId?: string;
  credentialId?: string;
  userId?: string;
  permissions: PermissionKey[];
  signingSecret?: string;
  actorType: "API" | "USER" | "DEVICE" | "SERVICE_ACCOUNT";
  unscoped?: boolean;
}

export function hasPermission(principal: AuthenticatedPrincipal, permission: PermissionKey): boolean {
  return principal.permissions.includes(permission) || principal.permissions.includes("admin:manage");
}

export function assertIdentityBinding(
  principal: AuthenticatedPrincipal,
  identity: { tenantId: string; productId?: string; installationId?: string }
): void {
  if (principal.unscoped) {
    return;
  }
  if (principal.tenantId !== identity.tenantId) {
    throw new Error("TENANT_MISMATCH");
  }
  if (principal.productId && identity.productId && principal.productId !== identity.productId) {
    throw new Error("PRODUCT_SCOPE_MISMATCH");
  }
  if (principal.installationId && identity.installationId && principal.installationId !== identity.installationId) {
    throw new Error("INSTALLATION_SCOPE_MISMATCH");
  }
}
