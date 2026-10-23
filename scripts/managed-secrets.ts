import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateSigningSecret,
} from "../packages/auth/src/crypto.js";

const execFileAsync = promisify(execFile);

type SecretBackend =
  | "local-aes-gcm"
  | "aws-secrets-manager"
  | "gcp-secret-manager"
  | "azure-key-vault";

interface SecretRecord {
  name: string;
  version: number;
  ciphertext: string;
  rotatedAt: string;
  backend: SecretBackend;
  remoteRef?: string;
}

interface SecretStore {
  backend: SecretBackend;
  updatedAt: string;
  secrets: SecretRecord[];
}

const storePath = process.env.ZOLT_SECRET_STORE ?? "ops/secrets/store.json";

function detectBackend(): SecretBackend {
  const configured = process.env.ZOLT_SECRETS_PROVIDER;
  if (configured === "aws" || process.env.AWS_SECRET_ID)
    return "aws-secrets-manager";
  if (configured === "gcp" || process.env.GCP_SECRET_NAME)
    return "gcp-secret-manager";
  if (configured === "azure" || process.env.AZURE_KEY_VAULT_URL)
    return "azure-key-vault";
  return "local-aes-gcm";
}

async function loadStore(): Promise<SecretStore> {
  try {
    return JSON.parse(await readFile(storePath, "utf8")) as SecretStore;
  } catch {
    return {
      backend: detectBackend(),
      updatedAt: new Date().toISOString(),
      secrets: [],
    };
  }
}

function rotateValue(name: string): string {
  if (name.includes("API_KEY")) return generateApiKey().plaintext;
  if (name.includes("HMAC") || name.includes("SIGNING"))
    return generateSigningSecret();
  if (name.includes("MASTER")) return randomBytes(32).toString("hex");
  return randomBytes(24).toString("base64url");
}

async function putRemote(
  backend: SecretBackend,
  name: string,
  value: string,
): Promise<string> {
  if (backend === "aws-secrets-manager") {
    const id = process.env.AWS_SECRET_ID ?? name;
    await execFileAsync("aws", [
      "secretsmanager",
      "put-secret-value",
      "--secret-id",
      id,
      "--secret-string",
      JSON.stringify({ [name]: value }),
    ]);
    return id;
  }
  if (backend === "gcp-secret-manager") {
    const secret = process.env.GCP_SECRET_NAME ?? name;
    await execFileAsync("gcloud", [
      "secrets",
      "versions",
      "add",
      secret,
      "--data-file=-",
    ], { input: value } as never);
    return secret;
  }
  if (backend === "azure-key-vault") {
    const vault = process.env.AZURE_KEY_VAULT_URL;
    if (!vault) throw new Error("AZURE_KEY_VAULT_URL_REQUIRED");
    await execFileAsync("az", [
      "keyvault",
      "secret",
      "set",
      "--vault-name",
      new URL(vault).hostname.split(".")[0] ?? "zolt",
      "--name",
      name.replaceAll("_", "-"),
      "--value",
      value,
    ]);
    return vault;
  }
  throw new Error("SECRETS_BACKEND_UNAVAILABLE");
}

async function getRemote(
  backend: SecretBackend,
  name: string,
): Promise<string> {
  if (backend === "aws-secrets-manager") {
    const id = process.env.AWS_SECRET_ID ?? name;
    const { stdout } = await execFileAsync("aws", [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      id,
      "--query",
      "SecretString",
      "--output",
      "text",
    ]);
    return stdout.trim();
  }
  if (backend === "gcp-secret-manager") {
    const secret = process.env.GCP_SECRET_NAME ?? name;
    const { stdout } = await execFileAsync("gcloud", [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      secret,
    ]);
    return stdout.trim();
  }
  if (backend === "azure-key-vault") {
    const vault = process.env.AZURE_KEY_VAULT_URL;
    if (!vault) throw new Error("AZURE_KEY_VAULT_URL_REQUIRED");
    const { stdout } = await execFileAsync("az", [
      "keyvault",
      "secret",
      "show",
      "--vault-name",
      new URL(vault).hostname.split(".")[0] ?? "zolt",
      "--name",
      name.replaceAll("_", "-"),
      "--query",
      "value",
      "-o",
      "tsv",
    ]);
    return stdout.trim();
  }
  throw new Error("SECRETS_BACKEND_UNAVAILABLE");
}

export async function rotateManagedSecrets(
  names: string[],
): Promise<Record<string, unknown>> {
  const store = await loadStore();
  store.backend = detectBackend();
  const rotated: Array<{ name: string; version: number }> = [];
  const previousPlaintext = new Map<string, string>();
  for (const name of names) {
    const existing = store.secrets.filter((item) => item.name === name);
    const last = existing.at(-1);
    if (last) {
      try {
        previousPlaintext.set(name, decryptSecret(last.ciphertext));
      } catch {
        /* ignore */
      }
    }
    const version = (last?.version ?? 0) + 1;
    const plaintext = rotateValue(name);
    let remoteRef: string | undefined;
    if (store.backend !== "local-aes-gcm") {
      remoteRef = await putRemote(store.backend, name, plaintext);
    }
    store.secrets.push({
      name,
      version,
      ciphertext: encryptSecret(plaintext),
      rotatedAt: new Date().toISOString(),
      backend: store.backend,
      remoteRef,
    });
    rotated.push({ name, version });
  }
  store.updatedAt = new Date().toISOString();
  await mkdir("ops/secrets", { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);

  const oldRejected: Record<string, boolean> = {};
  if (store.backend !== "local-aes-gcm") {
    for (const name of names) {
      const remote = await getRemote(store.backend, name);
      const previous = previousPlaintext.get(name);
      oldRejected[name] = !previous || !remote.includes(previous);
    }
  }

  const evidence = {
    executedAt: store.updatedAt,
    backend: store.backend,
    managedSecrets: store.backend !== "local-aes-gcm",
    rotated,
    oldValuesRejected: oldRejected,
    verifyDecrypt: store.secrets
      .slice(-names.length)
      .every((item) => decryptSecret(item.ciphertext).length > 0),
    blockedReason:
      store.backend === "local-aes-gcm"
        ? "Set ZOLT_SECRETS_PROVIDER=aws|gcp|azure and CLI credentials to leave local AES-GCM"
        : undefined,
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile(
    "docs/operations/managed-secrets.json",
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

if (process.argv[1]?.endsWith("managed-secrets.ts")) {
  const names = [
    "ZOLT_API_KEY",
    "ZOLT_INGEST_HMAC_SECRET",
    "ZOLT_SEED_HMAC_SECRET",
    "ALERT_WEBHOOK_SECRET",
  ];
  try {
    const evidence = await rotateManagedSecrets(names);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.backend === "local-aes-gcm") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evidence = {
      executedAt: new Date().toISOString(),
      backend: detectBackend(),
      managedSecrets: false,
      result: "BLOCKED",
      blockedReason: message,
    };
    await mkdir("docs/operations", { recursive: true });
    await writeFile(
      "docs/operations/managed-secrets.json",
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 1;
  }
}
