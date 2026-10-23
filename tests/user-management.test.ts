import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiDependencies } from "../apps/api/src/server.js";
import { setSessionResolver } from "@zolt/auth";

let buildApiApp: (deps: ApiDependencies, options?: { logger?: boolean }) => any;

beforeAll(async () => {
  const module = await import("../apps/api/src/server.js");
  buildApiApp = module.buildApiApp;
});

afterEach(() => {
  setSessionResolver(null);
});

function createDependencies(): ApiDependencies {
  return {
    enqueueTelemetry: vi.fn(async () => undefined),
    listTelemetryForInstallation: vi.fn(async () => []),
    saveRecommendations: vi.fn(async () => undefined),
    listRecommendations: vi.fn(async () => []),
    updateRecommendationStatus: vi.fn(async () => undefined),
    writeAuditEvent: vi.fn(async () => undefined),
    readinessCheck: vi.fn(async () => true),
    createOrchestrator: () => ({
      analyse: vi.fn(async () => []),
    }),
    authenticateUser: vi.fn(async () => null),
    getUserProfile: vi.fn(async () => null),
    revokeSession: vi.fn(async () => undefined),
    listUsers: vi.fn(async () => []),
    inviteUser: vi.fn(async () => ({ id: "user-2", invitationToken: "invite-token" })),
    deactivateUser: vi.fn(async () => undefined),
  };
}

function adminSession() {
  setSessionResolver(async (token) =>
    token === "session-token"
      ? {
          tenantId: "tenant-1",
          userId: "user-1",
          permissions: ["admin:manage"],
          actorType: "USER" as const,
        }
      : null,
  );
}

describe("user management", () => {
  it("signs in with email and password and returns a session token", async () => {
    const deps = createDependencies();
    deps.authenticateUser = vi.fn(async () => ({
      token: "session-token",
      tenantId: "tenant-1",
      userId: "user-1",
      name: "Admin",
      email: "admin@zolt.local",
    }));
    const app = buildApiApp(deps, { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@zolt.local", password: "ChangeMeNow!23" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      token: "session-token",
      email: "admin@zolt.local",
      name: "Admin",
    });
    await app.close();
  });

  it("rejects invalid credentials", async () => {
    const app = buildApiApp(createDependencies(), { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@zolt.local", password: "wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("INVALID_CREDENTIALS");
    await app.close();
  });

  it("revokes the current session on logout", async () => {
    adminSession();
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { authorization: "Bearer session-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: true });
    expect(deps.revokeSession).toHaveBeenCalledWith("session-token");
    await app.close();
  });

  it("returns the signed-in profile without secrets", async () => {
    adminSession();
    const deps = createDependencies();
    deps.getUserProfile = vi.fn(async () => ({
      id: "user-1",
      email: "admin@zolt.local",
      name: "Admin",
      mfaEnabled: false,
      emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
      lastLoginAt: new Date("2026-10-21T00:00:00Z"),
    }));
    const app = buildApiApp(deps, { logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer session-token" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.email).toBe("admin@zolt.local");
    expect(body.name).toBe("Admin");
    expect(body.passwordHash).toBeUndefined();
    expect(body.mfaSecret).toBeUndefined();
    await app.close();
  });

  it("lists tenant users without password hashes", async () => {
    adminSession();
    const deps = createDependencies();
    deps.listUsers = vi.fn(async () => [
      {
        id: "user-1",
        email: "admin@zolt.local",
        name: "Admin",
        status: "active",
        roles: [],
      },
    ]);
    const app = buildApiApp(deps, { logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: { authorization: "Bearer session-token" },
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json() as Array<Record<string, unknown>>;
    expect(rows[0]?.email).toBe("admin@zolt.local");
    expect(rows[0]?.passwordHash).toBeUndefined();
    await app.close();
  });

  it("invites and deactivates users", async () => {
    adminSession();
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });
    const invited = await app.inject({
      method: "POST",
      url: "/v1/users/invite",
      headers: { authorization: "Bearer session-token" },
      payload: {
        email: "operator@zolt.local",
        name: "Operator",
        roleKey: "operator",
      },
    });
    expect(invited.statusCode).toBe(200);
    expect(invited.json().invitationToken).toBe("invite-token");
    const deactivated = await app.inject({
      method: "POST",
      url: "/v1/users/user-2/deactivate",
      headers: { authorization: "Bearer session-token" },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deps.deactivateUser).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-2",
      actorId: "user-1",
    });
    await app.close();
  });
});
