import { TelemetryEnvelopeSchema, type ZoltTelemetryEnvelope } from "@zolt/contracts";
import type { ConnectorContext, ValidationResult, ZoltConnector } from "@zolt/connector-sdk";

export const GRIDFLEX_MEASUREMENT_MAP: Record<string, { key: string; unit?: string }> = {
  powerKw: { key: "powerKw", unit: "kW" },
  ac_power: { key: "powerKw", unit: "kW" },
  voltage: { key: "voltage", unit: "V" },
  ac_voltage: { key: "voltage", unit: "V" },
  frequency: { key: "frequencyHz", unit: "Hz" },
  frequencyHz: { key: "frequencyHz", unit: "Hz" },
  current: { key: "currentA", unit: "A" },
  currentA: { key: "currentA", unit: "A" },
  temperature: { key: "temperatureC", unit: "C" },
  soc: { key: "socPct", unit: "%" },
  powerFactor: { key: "powerFactor" },
  breakerClosed: { key: "breakerClosed" }
};

type GridFlexPayload = {
  messageId: string;
  siteId?: string;
  nodeId: string;
  assetId?: string;
  timestamp: string;
  sequence?: number;
  simulated?: boolean;
  firmwareVersion?: string;
  vendor?: string;
  model?: string;
  communicationHealth?: "HEALTHY" | "DEGRADED" | "FAILED";
  modbusQuality?: string;
  readings: Record<string, number | string | boolean>;
};

export class GridFlexConnector implements ZoltConnector {
  readonly connectorType = "gridflex";
  readonly connectorVersion = "1.0.0";
  readonly supportedContractVersions = ["1.0", "1.1"];

  validateConfiguration(c: unknown): ValidationResult {
    return { valid: typeof c === "object" && c !== null, errors: [] };
  }

  validatePayload(p: unknown): ValidationResult {
    const x = p as Partial<GridFlexPayload>;
    const errors: string[] = [];
    if (!x?.messageId) errors.push("messageId required");
    if (!x?.nodeId) errors.push("nodeId required");
    if (!x?.timestamp) errors.push("timestamp required");
    if (!x?.readings || typeof x.readings !== "object") errors.push("readings required");
    if (x?.timestamp && Number.isNaN(Date.parse(x.timestamp))) errors.push("timestamp invalid");
    return { valid: errors.length === 0, errors };
  }

  async transform(payload: unknown, ctx: ConnectorContext): Promise<ZoltTelemetryEnvelope[]> {
    const p = payload as GridFlexPayload;
    const measurements = Object.entries(p.readings).map(([rawKey, value]) => {
      const mapped = GRIDFLEX_MEASUREMENT_MAP[rawKey] ?? { key: rawKey };
      const quality =
        p.communicationHealth === "FAILED" ? ("INVALID" as const) : p.modbusQuality === "bad" ? ("UNCERTAIN" as const) : ("GOOD" as const);
      return { key: mapped.key, value, unit: mapped.unit, quality };
    });

    const env = {
      schemaVersion: "1.1" as const,
      messageId: p.messageId,
      tenantId: ctx.tenantId,
      productId: ctx.productId,
      installationId: ctx.installationId,
      siteId: p.siteId,
      deviceId: p.nodeId,
      assetId: p.assetId,
      sourceTimestamp: p.timestamp,
      receivedTimestamp: ctx.receivedAt,
      sequenceNumber: p.sequence,
      simulated: p.simulated === true,
      firmwareVersion: p.firmwareVersion,
      vendor: p.vendor,
      model: p.model,
      communicationHealth: p.communicationHealth,
      measurements,
      metadata: {
        connectorType: this.connectorType,
        connectorVersion: this.connectorVersion,
        ...(p.simulated ? { simulated: true } : {}),
        ...(p.modbusQuality ? { modbusQuality: p.modbusQuality } : {})
      }
    };
    return [TelemetryEnvelopeSchema.parse(env)];
  }

  async testConnection() {
    return { healthy: true, status: "HEALTHY" as const, message: "GridFlex connector 1.0.0 ready" };
  }

  getCapabilities() {
    return ["telemetry", "forecasts", "alarms", "device-health", "store-and-forward"];
  }
}
