import type { WebhookDeliveryPayload } from "@zolt/queue";
import { requestSafeWebhook } from "@zolt/auth";
import { createHmac } from "node:crypto";

export async function deliverWebhookPayload(
  payload: WebhookDeliveryPayload,
): Promise<void> {
  const body = JSON.stringify(payload.payload);
  const timestamp = Date.now().toString();
  const idempotencyId =
    payload.idempotencyId ??
    `${payload.endpointId ?? "env"}:${payload.recommendationId}:${payload.eventType}`;
  const signature = payload.webhookSecret
    ? createHmac("sha256", payload.webhookSecret)
        .update(`${timestamp}.${idempotencyId}.${body}`)
        .digest("hex")
    : undefined;

  const response = await requestSafeWebhook({
    url: payload.webhookUrl,
    body,
    headers: {
      "content-type": "application/json",
      "x-zolt-event-type": payload.eventType,
      "x-zolt-timestamp": timestamp,
      "x-zolt-idempotency-id": idempotencyId,
      ...(signature
        ? { "x-zolt-signature": `t=${timestamp},v1=${signature}` }
        : {}),
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`WEBHOOK_DELIVERY_FAILED:${response.status}`);
  }
}
