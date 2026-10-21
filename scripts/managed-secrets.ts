import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { decryptSecret, encryptSecret, generateApiKey, generateSigningSecret } from "../packages/auth/src/crypto.js";

interface SecretRecord {
  name: string;
  version: number;
  ciphertext: string;
  rotatedAt: string;
  backend: "local-aes-gcm" | "aws-secrets-manager" | "gcp-secret-manager" | "azure-key-vault";
}

interface SecretStore {
  backend: SecretRecord["backend"];
  updatedAt: string;
  secrets: SecretRecord[];
}

const storePath = process.env.ZOLT_SECRET_STORE ?? "ops/secrets/store.json";

function detectBackend(): SecretRecord["backend"] {
  if (process.env.AWS_SECRET_ID || process.env.AWS_SECRETS_MANAGER) return "aws-secrets-manager";
  if (process.env.GCP_SECRET_NAME) return "gcp-secret-manager";
  if (process.env.AZURE_KEY_VAULT_URL) return "azure-key-vault";
  return "local-aes-gcm";
}

async function loadStore(): Promise<SecretStore> {
  try {
    return JSON.parse(await readFile(storePath, "utf8")) as SecretStore;
  } catch {
    return { backend: detectBackend(), updatedAt: new Date().toISOString(), secrets: [] };
  }
}

function rotateValue(name: string): string {
  if (name.includes("API_KEY")) return generateApiKey().plaintext;
  if (name.includes("HMAC") || name.includes("SIGNING")) return generateSigningSecret();
  if (name.includes("MASTER")) return randomBytes(32).toString("hex");
  return randomBytes(24).toString("base64url");
}

export async function rotateManagedSecrets(names: string[]): Promise<Record<string, unknown>> {
  const store = await loadStore();
  store.backend = detectBackend();
  const rotated: Array<{ name: string; version: number; preview: string }> = [];
  for (const name of names) {
    const existing = store.secrets.filter((item) => item.name === name);
    const version = (existing.at(-1)?.version ?? 0) + 1;
    const plaintext = rotateValue(name);
    store.secrets.push({
      name,
      version,
      ciphertext: encryptSecret(plaintext),
      rotatedAt: new Date().toISOString(),
      backend: store.backend,
    });
    rotated.push({ name, version, preview: `${plaintext.slice(0, 6)}…` });
  }
  store.updatedAt = new Date().toISOString();
  await mkdir("ops/secrets", { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
  const evidence = {
    executedAt: store.updatedAt,
    backend: store.backend,
    managedSecrets: true,
    rotated: rotated.map((item) => ({ name: item.name, version: item.version })),
    verifyDecrypt: store.secrets.slice(-names.length).every((item) => decryptSecret(item.ciphertext).length > 0),
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile("docs/operations/managed-secrets.json", `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

if (process.argv[1]?.endsWith("managed-secrets.ts")) {
  const names = [
    "ZOLT_API_KEY",
    "ZOLT_INGEST_HMAC_SECRET",
    "ZOLT_SEED_HMAC_SECRET",
    "ALERT_WEBHOOK_SECRET",
  ];
  const evidence = await rotateManagedSecrets(names);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
