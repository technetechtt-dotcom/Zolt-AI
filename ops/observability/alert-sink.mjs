import { createServer } from "node:http";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

const port = Number(process.env.ALERT_SINK_PORT ?? 9095);
const logPath = process.env.ALERT_SINK_LOG ?? "/app/docs/operations/alert-routing.jsonl";

await mkdir(dirname(logPath), { recursive: true });

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "zolt-alert-sink" }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  const record = {
    receivedAt: new Date().toISOString(),
    method: req.method,
    url: req.url,
    body: body.slice(0, 32_000)
  };
  try {
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`alert-sink write failed: ${error}\n`);
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ accepted: true }));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`zolt-alert-sink listening on ${port}\n`);
});
