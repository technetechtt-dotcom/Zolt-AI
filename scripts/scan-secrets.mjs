import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "dist", ".git", ".pnpm-store"]);
const PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|js|mjs|json|yml|yaml|env|md)$/i.test(entry) && !entry.endsWith(".example")) {
      files.push(full);
    }
  }
  return files;
}

const hits = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) {
      hits.push(`${file} matched ${pattern}`);
    }
  }
}

if (hits.length > 0) {
  console.error(hits.join("\n"));
  process.exit(1);
}

console.log("Secret scan passed");
