import {
  TelemetryEnvelopeSchema,
  type ZoltTelemetryEnvelope,
} from "@zolt/contracts";
import type {
  ConnectorContext,
  ValidationResult,
  ZoltConnector,
} from "@zolt/connector-sdk";

export const GRIDFLEX_MEASUREMENT_MAP: Record<
  string,
  { key: string; unit?: string }
> = {
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
  breakerClosed: { key: "breakerClosed" },
};

export interface ModbusRegisterSpec {
  address: number;
  key: string;
  unit?: string;
  dataType: "uint16" | "int16" | "uint32" | "int32";
  scale?: number;
  wordOrder?: "big" | "little";
}

export interface GridFlexInverterProfile {
  manufacturer: string;
  model: string;
  protocolVersion: string;
  registers: ModbusRegisterSpec[];
}

export function modbusCrc16(frame: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of frame) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

export function decodeGridFlexRegisters(
  registers: Record<number, number>,
  profile: GridFlexInverterProfile,
): Record<string, number> {
  const decoded: Record<string, number> = {};
  for (const spec of profile.registers) {
    const first = registers[spec.address];
    if (
      first === undefined ||
      !Number.isInteger(first) ||
      first < 0 ||
      first > 0xffff
    )
      continue;
    let raw: number;
    if (spec.dataType === "uint16") raw = first;
    else if (spec.dataType === "int16")
      raw = first & 0x8000 ? first - 0x10000 : first;
    else {
      const second = registers[spec.address + 1];
      if (
        second === undefined ||
        !Number.isInteger(second) ||
        second < 0 ||
        second > 0xffff
      )
        continue;
      const high = spec.wordOrder === "little" ? second : first;
      const low = spec.wordOrder === "little" ? first : second;
      const unsigned = high * 0x10000 + low;
      raw =
        spec.dataType === "int32" && unsigned >= 0x80000000
          ? unsigned - 0x100000000
          : unsigned;
    }
    decoded[spec.key] = raw * (spec.scale ?? 1);
  }
  return decoded;
}

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
    if (!x?.readings || typeof x.readings !== "object")
      errors.push("readings required");
    if (x?.timestamp && Number.isNaN(Date.parse(x.timestamp)))
      errors.push("timestamp invalid");
    return { valid: errors.length === 0, errors };
  }

  async transform(
    payload: unknown,
    ctx: ConnectorContext,
  ): Promise<ZoltTelemetryEnvelope[]> {
    const p = payload as GridFlexPayload;
    const measurements = Object.entries(p.readings).map(([rawKey, value]) => {
      const mapped = GRIDFLEX_MEASUREMENT_MAP[rawKey] ?? { key: rawKey };
      const quality =
        p.communicationHealth === "FAILED"
          ? ("INVALID" as const)
          : p.modbusQuality === "bad"
            ? ("UNCERTAIN" as const)
            : ("GOOD" as const);
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
        ...(p.modbusQuality ? { modbusQuality: p.modbusQuality } : {}),
      },
    };
    return [TelemetryEnvelopeSchema.parse(env)];
  }

  async testConnection() {
    return {
      healthy: true,
      status: "HEALTHY" as const,
      message: "GridFlex connector 1.0.0 ready",
    };
  }

  getCapabilities() {
    return [
      "telemetry",
      "forecasts",
      "alarms",
      "device-health",
      "store-and-forward",
    ];
  }
}
