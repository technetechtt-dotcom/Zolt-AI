import { describe, expect, it } from "vitest";
import { consoleHtml } from "../apps/console/src/ui.js";

describe("console authentication UI", () => {
  const html = consoleHtml("http://localhost:4000");

  it("has a sign-in form that posts to login", () => {
    expect(html).toContain('id="login"');
    expect(html).toContain("/v1/auth/login");
    expect(html).toContain("Sign in");
  });

  it("signs out by revoking the current session", () => {
    expect(html).toContain("/v1/auth/logout");
    expect(html).toContain('id="signOut"');
    expect(html).toContain("Sign out");
  });

  it("lets admins invite and deactivate users", () => {
    expect(html).toContain("/v1/users/invite");
    expect(html).toContain("/deactivate");
    expect(html).toContain("Invite user");
  });

  it("labels platform operators in the session bar", () => {
    expect(html).toContain("Platform operator");
  });
});
