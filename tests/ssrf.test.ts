import { describe, expect, it } from "vitest";
import {
  assertSafeWebhookUrl,
  isBlockedIp,
} from "../packages/auth/src/ssrf.js";

describe("Webhook SSRF protection", () => {
  it("blocks loopback and private IPs", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("rejects localhost URLs", async () => {
    await expect(assertSafeWebhookUrl("http://localhost/hook")).rejects.toThrow(
      /SSRF_BLOCKED|PROTOCOL/,
    );
  });

  it("rejects metadata hosts", async () => {
    await expect(
      assertSafeWebhookUrl("http://metadata.google.internal/"),
    ).rejects.toThrow(/SSRF_BLOCKED/);
  });

  it("rejects non-http protocols", async () => {
    await expect(assertSafeWebhookUrl("file:///etc/passwd")).rejects.toThrow(
      /PROTOCOL_FORBIDDEN/,
    );
  });
});
