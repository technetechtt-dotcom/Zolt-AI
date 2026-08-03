import type { WebhookDeliveryPayload } from "@zolt/queue";
import { createHmac } from "node:crypto";

export async function deliverWebhookPayload(payload: WebhookDeliveryPayload): Promise<void> {
  const body = JSON.stringify(payload.payload);
  const signature = payload.webhookSecret
    ? createHmac("sha256", payload.webhookSecret).update(body).digest("hex")
    : undefined;

  const response = await fetch(payload.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-event-type": payload.eventType,
      ...(signature ? { "x-zolt-signature": signature } : {})
    },
    body
  });

  if (!response.ok) {
    throw new Error(`WEBHOOK_DELIVERY_FAILED:${response.status}`);
  }
}
