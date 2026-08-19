import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function allowInsecureAuth(): boolean {
  if (isProduction()) {
    return false;
  }
  return process.env.ZOLT_ALLOW_INSECURE_AUTH === "true";
}

export function hashSecret(
  value: string,
  salt = randomBytes(16).toString("hex"),
): string {
  const derived = scryptSync(value, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

export function verifySecret(value: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) {
    return false;
  }
  const actual = scryptSync(value, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actual, expectedBuf);
}

export function safeCompare(value: string, expected: string): boolean {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function masterKey(): Buffer {
  const configured = process.env.ZOLT_MASTER_KEY;
  if (
    isProduction() &&
    (!configured ||
      configured === "dev-master-key-not-for-production" ||
      configured.length < 32)
  ) {
    throw new Error("PRODUCTION_MASTER_KEY_REQUIRED");
  }
  const secret = configured ?? "dev-master-key-not-for-production";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("INVALID_SECRET_PAYLOAD");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateApiKey(): { plaintext: string; prefix: string } {
  const plaintext = `zolt_${randomBytes(24).toString("base64url")}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

export function generateSigningSecret(): string {
  return randomBytes(32).toString("hex");
}
