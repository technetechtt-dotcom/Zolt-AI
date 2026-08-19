import "dotenv/config";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { assertProductionConfiguration } from "@zolt/auth";
import { consoleHtml } from "./ui.js";

export function buildConsoleApp() {
  const app = Fastify({ logger: !process.env.VITEST });
  const html = consoleHtml(
    process.env.ZOLT_API_BASE_URL ?? "http://localhost:4000",
  );
  app.get("/health/live", async () => ({
    status: "ok",
    service: "zolt-console",
  }));
  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(html);
  });
  app.setNotFoundHandler(async (_req, reply) => {
    reply.type("text/html").send(html);
  });
  return app;
}

export async function startConsoleServer(): Promise<void> {
  assertProductionConfiguration("console");
  const app = buildConsoleApp();
  await app.listen({
    port: Number(process.env.CONSOLE_PORT ?? 4002),
    host: "0.0.0.0",
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startConsoleServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
