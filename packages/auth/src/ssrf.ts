import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc * 256 + Number(octet)) >>> 0, 0);
}

function inIpv4Range(ip: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function isPrivateIPv4(ip: string): boolean {
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([network, prefix]) =>
    inIpv4Range(ip, String(network), Number(prefix)),
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateIPv4(mapped);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return true;
}

function hostAllowed(hostname: string): boolean {
  const configured = process.env.ZOLT_WEBHOOK_ALLOWLIST;
  if (!configured) return true;
  const patterns = configured
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return patterns.some((pattern) =>
    pattern.startsWith("*.")
      ? hostname.endsWith(pattern.slice(1)) && hostname !== pattern.slice(2)
      : hostname === pattern,
  );
}

function portAllowed(url: URL): boolean {
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const defaults = url.protocol === "https:" ? [443] : [80];
  const configured = process.env.ZOLT_WEBHOOK_ALLOWED_PORTS;
  const allowed = configured
    ? configured.split(",").map(Number).filter(Number.isInteger)
    : defaults;
  return allowed.includes(port);
}

async function validateAndResolve(
  raw: string,
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WEBHOOK_URL_INVALID");
  }
  if (url.username || url.password)
    throw new Error("WEBHOOK_URL_CREDENTIALS_FORBIDDEN");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("WEBHOOK_URL_PROTOCOL_FORBIDDEN");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("WEBHOOK_URL_HTTPS_REQUIRED");
  if (!portAllowed(url)) throw new Error("WEBHOOK_URL_PORT_FORBIDDEN");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostAllowed(hostname)) throw new Error("WEBHOOK_URL_NOT_ALLOWLISTED");
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("WEBHOOK_URL_SSRF_BLOCKED");
  }
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("WEBHOOK_URL_SSRF_BLOCKED");
    return { url, address: hostname, family: isIP(hostname) };
  }
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (
    resolved.length === 0 ||
    resolved.some((item) => isBlockedIp(item.address))
  ) {
    throw new Error("WEBHOOK_URL_SSRF_BLOCKED");
  }
  const selected = resolved[0]!;
  return { url, address: selected.address, family: selected.family };
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  return (await validateAndResolve(raw)).url;
}

export interface SafeWebhookResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export async function requestSafeWebhook(input: {
  url: string;
  body: string;
  headers?: Record<string, string>;
  redirects?: number;
}): Promise<SafeWebhookResponse> {
  const timeoutMs = Number(process.env.ZOLT_WEBHOOK_TIMEOUT_MS ?? 10_000);
  const maximumBytes = Number(
    process.env.ZOLT_WEBHOOK_MAX_RESPONSE_BYTES ?? 64 * 1024,
  );
  const maximumRedirects = Number(process.env.ZOLT_WEBHOOK_MAX_REDIRECTS ?? 2);
  const redirectCount = input.redirects ?? 0;
  const destination = await validateAndResolve(input.url);
  const request =
    destination.url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = await new Promise<SafeWebhookResponse>((resolve, reject) => {
    const req = request(
      {
        protocol: destination.url.protocol,
        hostname: destination.address,
        family: destination.family,
        port:
          destination.url.port ||
          (destination.url.protocol === "https:" ? 443 : 80),
        method: "POST",
        path: `${destination.url.pathname}${destination.url.search}`,
        servername: destination.url.hostname,
        headers: {
          host: destination.url.host,
          "content-length": Buffer.byteLength(input.body),
          ...(input.headers ?? {}),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximumBytes) {
            req.destroy(new Error("WEBHOOK_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("WEBHOOK_TIMEOUT")));
    req.on("error", reject);
    req.end(input.body);
  });

  if (
    [301, 302, 303, 307, 308].includes(body.status) &&
    body.headers.location
  ) {
    if (redirectCount >= maximumRedirects)
      throw new Error("WEBHOOK_REDIRECT_LIMIT");
    const location = Array.isArray(body.headers.location)
      ? body.headers.location[0]
      : body.headers.location;
    return requestSafeWebhook({
      ...input,
      url: new URL(location!, destination.url).toString(),
      redirects: redirectCount + 1,
    });
  }
  return body;
}
