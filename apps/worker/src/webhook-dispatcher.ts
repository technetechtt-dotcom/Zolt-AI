import type { WebhookDeliveryPayload } from "@zolt/queue";
import { createHmac } from "node:crypto";

export async function deliverWebhookPayload(payload: WebhookDeliveryPayload): Promise<void> {
  const body = JSON.stringify(payload.payload);
  const timestamp = Date.now().toString();
  const idempotencyId = payload.idempotencyId ?? `${payload.endpointId ?? "env"}:${payload.recommendationId}:${payload.eventType}`;
  const signature = payload.webhookSecret
    ? createHmac("sha256", payload.webhookSecret).update(`${timestamp}.${idempotencyId}.${body}`).digest("hex")
    : undefined;

  const response = await fetch(payload.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-event-type": payload.eventType,
      "x-zolt-timestamp": timestamp,
      "x-zolt-idempotency-id": idempotencyId,
      ...(signature ? { "x-zolt-signature": `t=${timestamp},v1=${signature}` } : {})
    },
    body
  });

  if (!response.ok) {
    throw new Error(`WEBHOOK_DELIVERY_FAILED:${response.status}`);
  }
}
