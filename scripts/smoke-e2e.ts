import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";

const gatewayUrl = process.env.ZOLT_GATEWAY_URL ?? "http://localhost:4001";
const apiUrl = process.env.ZOLT_API_BASE_URL ?? "http://localhost:4000";
const tenantId = process.env.ZOLT_SMOKE_TENANT_ID ?? "tenant-smoke";
const productId = process.env.ZOLT_SMOKE_PRODUCT_ID ?? "product-smoke";
const installationId = process.env.ZOLT_SMOKE_INSTALLATION_ID ?? "installation-smoke";
const apiKey = process.env.ZOLT_API_KEY ?? "";
const hmacSecret = process.env.ZOLT_INGEST_HMAC_SECRET ?? "";

function signedHeaders(payload: Record<string, unknown>): Record<string, string> {
  const timestamp = Date.now().toString();
  const replayKey = randomUUID();
  const signature = createHmac("sha256", hmacSecret)
    .update(`${timestamp}.${replayKey}.${JSON.stringify(payload)}`)
    .digest("hex");

  return {
    "x-zolt-signature-ts": timestamp,
    "x-zolt-replay-key": replayKey,
    "x-zolt-signature": signature
  };
}

async function main(): Promise<void> {
  if (!apiKey || !hmacSecret) {
    throw new Error("Set ZOLT_API_KEY and ZOLT_INGEST_HMAC_SECRET before running smoke test.");
  }

  const ingestPayload = {
    messageId: `smoke-${Date.now()}`,
    nodeId: "node-smoke-1",
    timestamp: new Date().toISOString(),
    readings: {
      powerKw: 135.5,
      voltage: 398.2,
      breakerClosed: true
    }
  };

  const ingestResponse = await fetch(`${gatewayUrl}/v1/ingest/gridflex`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-api-key": apiKey,
      "x-zolt-tenant-id": tenantId,
      "x-zolt-product-id": productId,
      "x-zolt-installation-id": installationId,
      ...signedHeaders(ingestPayload)
    },
    body: JSON.stringify(ingestPayload)
  });

  if (!ingestResponse.ok) {
    throw new Error(`Gateway ingest failed: ${ingestResponse.status} ${await ingestResponse.text()}`);
  }

  const analysisResponse = await fetch(`${apiUrl}/v1/analysis`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-api-key": apiKey
    },
    body: JSON.stringify({
      tenantId,
      productId,
      installationId,
      configuration: {
        expectedSamplingSeconds: 5,
        exportLimitKw: 120,
        forecastPowerKw: 150,
        forecastWindowHours: 1
      }
    })
  });

  if (!analysisResponse.ok) {
    throw new Error(`Analysis failed: ${analysisResponse.status} ${await analysisResponse.text()}`);
  }

  const analysisBody = (await analysisResponse.json()) as {
    advisoryOnly: boolean;
    recommendations: Array<{ id: string; type: string; title: string }>;
  };

  const recResponse = await fetch(
    `${apiUrl}/v1/recommendations?tenantId=${encodeURIComponent(tenantId)}&productId=${encodeURIComponent(productId)}&installationId=${encodeURIComponent(installationId)}`,
    {
      headers: {
        "x-zolt-api-key": apiKey
      }
    }
  );

  if (!recResponse.ok) {
    throw new Error(`Recommendation fetch failed: ${recResponse.status} ${await recResponse.text()}`);
  }

  const persisted = (await recResponse.json()) as Array<{ id: string; type: string; title: string }>;

  if (analysisBody.recommendations.length === 0) {
    throw new Error("Smoke generated zero recommendations.");
  }
  if (persisted.length === 0) {
    throw new Error("Smoke found zero persisted recommendations.");
  }

  const generatedIds = new Set(analysisBody.recommendations.map((item) => item.id));
  const persistedIds = new Set(persisted.map((item) => item.id));
  for (const recommendationId of generatedIds) {
    if (!persistedIds.has(recommendationId)) {
      throw new Error(`Recommendation ${recommendationId} was generated but not persisted.`);
    }
  }

  console.log("Smoke completed", {
    advisoryOnly: analysisBody.advisoryOnly,
    generatedRecommendationCount: analysisBody.recommendations.length,
    persistedRecommendationCount: persisted.length
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Smoke failed:", message);
  process.exit(1);
});
