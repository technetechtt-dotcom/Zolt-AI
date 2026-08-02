import type { WebhookDeliveryPayload } from "@zolt/queue";

export async function deliverWebhookPayload(payload: WebhookDeliveryPayload): Promise<void> {
  const response = await fetch(payload.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-event-type": payload.eventType
    },
    body: JSON.stringify(payload.payload)
  });

  if (!response.ok) {
    throw new Error(`WEBHOOK_DELIVERY_FAILED:${response.status}`);
  }
}
