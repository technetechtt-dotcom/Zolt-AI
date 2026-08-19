import { describe, expect, it } from "vitest";
import {
  decodeGridFlexRegisters,
  GridFlexConnector,
  modbusCrc16,
} from "../connectors/gridflex/src/index.js";
import { validateTelemetryEnvelope } from "../packages/core/src/telemetry.js";

const connector = new GridFlexConnector();
const ctx = {
  tenantId: "tenant-hil",
  productId: "product-hil",
  installationId: "installation-hil",
  receivedAt: new Date().toISOString(),
};

async function transform(payload: Record<string, unknown>) {
  return connector.transform(payload, ctx);
}

describe("GridFlex HIL scenarios", () => {
  it("decodes scaling, word order, and signed registers from an emulator profile", () => {
    const decoded = decodeGridFlexRegisters(
      { 100: 4001, 101: 0xffff, 102: 0xff9c, 103: 0x0001, 104: 0x0002 },
      {
        manufacturer: "emulator",
        model: "verified-profile-v1",
        protocolVersion: "modbus-rtu",
        registers: [
          {
            address: 100,
            key: "voltage",
            unit: "V",
            dataType: "uint16",
            scale: 0.1,
          },
          {
            address: 101,
            key: "signedCurrent",
            unit: "A",
            dataType: "int16",
            scale: 0.1,
          },
          {
            address: 103,
            key: "energy",
            unit: "kWh",
            dataType: "uint32",
            wordOrder: "little",
            scale: 1,
          },
        ],
      },
    );
    expect(decoded.voltage).toBeCloseTo(400.1);
    expect(decoded.signedCurrent).toBeCloseTo(-0.1);
    expect(decoded.energy).toBe(131073);
  });

  it("calculates Modbus CRC and detects corruption", () => {
    const frame = Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
    const crc = modbusCrc16(frame);
    expect(crc).toBe(0xcdc5);
    expect(modbusCrc16(Uint8Array.from([...frame.slice(0, 5), 0x0b]))).not.toBe(
      crc,
    );
  });
  it("rejects malformed inverter data", () => {
    expect(connector.validatePayload({ nodeId: "inv-1" }).valid).toBe(false);
  });

  it("detects delayed inverter data", async () => {
    const received = new Date();
    const source = new Date(received.getTime() - 10 * 60_000);
    const [envelope] = await transform({
      messageId: "hil-delayed-0001",
      nodeId: "inv-1",
      timestamp: source.toISOString(),
      readings: { powerKw: 40 },
    });
    const checked = validateTelemetryEnvelope({
      ...envelope,
      receivedTimestamp: received.toISOString(),
    });
    expect(checked.delayed).toBe(true);
    expect(checked.envelope?.simulated).not.toBe(true);
  });

  it("keeps duplicate message IDs stable for store-and-forward replay", async () => {
    const payload = {
      messageId: "hil-replay-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      sequence: 9,
      readings: { powerKw: 41 },
    };
    const first = await transform(payload);
    const second = await transform(payload);
    expect(first[0]?.messageId).toBe(second[0]?.messageId);
  });

  it("rejects impossible inverter values", async () => {
    const [envelope] = await transform({
      messageId: "hil-impossible-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      readings: { voltage: 9000 },
    });
    const checked = validateTelemetryEnvelope(envelope);
    expect(checked.errors.some((item) => item.includes("physical range"))).toBe(
      true,
    );
  });

  it("marks communication loss", async () => {
    const [envelope] = await transform({
      messageId: "hil-loss-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      communicationHealth: "FAILED",
      readings: { powerKw: 0 },
    });
    expect(envelope.communicationHealth).toBe("FAILED");
    expect(envelope.measurements[0]?.quality).toBe("INVALID");
  });

  it("handles device restart sequence reset", async () => {
    const [before] = await transform({
      messageId: "hil-restart-1",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      sequence: 100,
      readings: { powerKw: 30 },
    });
    const [after] = await transform({
      messageId: "hil-restart-2",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      sequence: 1,
      readings: { powerKw: 5 },
    });
    expect(before.sequenceNumber).toBe(100);
    expect(after.sequenceNumber).toBe(1);
  });

  it("labels simulated telemetry so it cannot be mistaken for live plant data", async () => {
    const [live] = await transform({
      messageId: "hil-live-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      simulated: false,
      readings: { powerKw: 20 },
    });
    const [sim] = await transform({
      messageId: "hil-sim-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      simulated: true,
      readings: { powerKw: 20 },
    });
    expect(live.simulated).toBe(false);
    expect(sim.simulated).toBe(true);
    expect(sim.metadata?.simulated).toBe(true);
  });

  it("recovers after a network outage by accepting the next healthy frame", async () => {
    const [envelope] = await transform({
      messageId: "hil-recovery-0001",
      nodeId: "inv-1",
      timestamp: new Date().toISOString(),
      communicationHealth: "HEALTHY",
      readings: { powerKw: 33, voltage: 400, frequency: 50 },
    });
    const checked = validateTelemetryEnvelope(envelope);
    expect(checked.errors).toEqual([]);
    expect(checked.envelope?.communicationHealth).toBe("HEALTHY");
  });
});
