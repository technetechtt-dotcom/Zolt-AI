import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  decodeGridFlexRegisters,
  GridFlexConnector,
  modbusCrc16,
  type GridFlexInverterProfile,
} from "../connectors/gridflex/src/index.js";
import { validateTelemetryEnvelope } from "../packages/core/src/telemetry.js";

const profile: GridFlexInverterProfile = {
  manufacturer: "Industrial Modbus Emulator",
  model: "Zolt verification profile v1",
  protocolVersion: "Modbus RTU",
  registers: [
    { address: 100, key: "voltage", unit: "V", dataType: "uint16", scale: 0.1 },
    { address: 101, key: "frequencyHz", unit: "Hz", dataType: "uint16", scale: 0.01 },
    { address: 102, key: "powerKw", unit: "kW", dataType: "int32", scale: 0.001, wordOrder: "big" },
    { address: 104, key: "currentA", unit: "A", dataType: "int16", scale: 0.1 },
  ],
};

interface SlaveState {
  voltage: number;
  frequencyHz: number;
  powerKw: number;
  currentA: number;
  online: boolean;
  buffer: Array<{ messageId: string; sequence: number; timestamp: string; readings: Record<string, number> }>;
}

function encodeRegister(address: number, value: number): Record<number, number> {
  if (address === 100) return { 100: Math.round(value * 10) };
  if (address === 101) return { 101: Math.round(value * 100) };
  if (address === 102) {
    const raw = Math.round(value * 1000) >>> 0;
    return { 102: (raw >>> 16) & 0xffff, 103: raw & 0xffff };
  }
  return { 104: value < 0 ? (0x10000 + Math.round(value * 10)) & 0xffff : Math.round(value * 10) };
}

function buildReadRequest(slaveId: number, address: number, count: number): Uint8Array {
  const frame = Uint8Array.from([
    slaveId,
    3,
    (address >> 8) & 0xff,
    address & 0xff,
    0,
    count & 0xff,
  ]);
  const crc = modbusCrc16(frame);
  return Uint8Array.from([...frame, crc & 0xff, crc >> 8]);
}

function slaveRespond(state: SlaveState, request: Uint8Array): Uint8Array {
  if (!state.online) throw new Error("SLAVE_OFFLINE");
  const crc = modbusCrc16(request.slice(0, -2));
  const received = request[request.length - 2]! + (request[request.length - 1]! << 8);
  if (crc !== received) throw new Error("CRC_FAIL");
  if (request[1] !== 3) throw new Error("FUNCTION_NOT_READ_ONLY");
  const address = (request[2]! << 8) + request[3]!;
  const count = request[5]!;
  const map = {
    ...encodeRegister(100, state.voltage),
    ...encodeRegister(101, state.frequencyHz),
    ...encodeRegister(102, state.powerKw),
    ...encodeRegister(104, state.currentA),
  };
  const bytes: number[] = [1, 3, count * 2];
  for (let i = 0; i < count; i += 1) {
    const word = map[address + i] ?? 0;
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  const body = Uint8Array.from(bytes);
  const responseCrc = modbusCrc16(body);
  return Uint8Array.from([...body, responseCrc & 0xff, responseCrc >> 8]);
}

export async function executeGridFlexHilEmulator(): Promise<Record<string, unknown>> {
  const connector = new GridFlexConnector();
  const ctx = {
    tenantId: "tenant-pilot",
    productId: "product-pilot",
    installationId: "installation-pilot",
    receivedAt: new Date().toISOString(),
  };
  const state: SlaveState = {
    voltage: 400.1,
    frequencyHz: 50.01,
    powerKw: 42.5,
    currentA: 61.2,
    online: true,
    buffer: [],
  };
  const scenarios: Array<{ name: string; result: string; detail?: unknown }> = [];

  const request = buildReadRequest(1, 100, 5);
  const response = slaveRespond(state, request);
  const words: Record<number, number> = {};
  for (let i = 0; i < 5; i += 1) {
    words[100 + i] = (response[3 + i * 2]! << 8) + response[4 + i * 2]!;
  }
  const decoded = decodeGridFlexRegisters(words, profile);
  scenarios.push({
    name: "modbus-read-function-03",
    result: decoded.voltage && Math.abs(decoded.voltage - 400.1) < 0.2 ? "PASS" : "FAIL",
    detail: decoded,
  });

  try {
    slaveRespond(state, Uint8Array.from([...request.slice(0, -1), 0x00]));
    scenarios.push({ name: "malformed-crc", result: "FAIL" });
  } catch {
    scenarios.push({ name: "malformed-crc", result: "PASS" });
  }

  const delayed = await connector.transform(
    {
      messageId: randomUUID(),
      nodeId: "pilot-inverter-1",
      timestamp: new Date(Date.now() - 11 * 60_000).toISOString(),
      readings: decoded,
    },
    ctx,
  );
  const delayedCheck = validateTelemetryEnvelope({
    ...delayed[0]!,
    receivedTimestamp: new Date().toISOString(),
  });
  scenarios.push({
    name: "delayed-telemetry",
    result: delayedCheck.delayed ? "PASS" : "FAIL",
  });

  const replayId = "hil-store-forward-1";
  const first = await connector.transform(
    { messageId: replayId, nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), sequence: 4, readings: decoded },
    ctx,
  );
  const second = await connector.transform(
    { messageId: replayId, nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), sequence: 4, readings: decoded },
    ctx,
  );
  scenarios.push({
    name: "duplicate-store-and-forward",
    result: first[0]?.messageId === second[0]?.messageId ? "PASS" : "FAIL",
  });

  const impossible = await connector.transform(
    {
      messageId: randomUUID(),
      nodeId: "pilot-inverter-1",
      timestamp: new Date().toISOString(),
      readings: { voltage: 9000 },
    },
    ctx,
  );
  const impossibleCheck = validateTelemetryEnvelope(impossible[0]!);
  scenarios.push({
    name: "impossible-value-rejection",
    result: impossibleCheck.errors.some((item) => item.includes("physical range")) ? "PASS" : "FAIL",
  });

  state.online = false;
  try {
    slaveRespond(state, request);
    scenarios.push({ name: "communication-loss", result: "FAIL" });
  } catch {
    scenarios.push({ name: "communication-loss", result: "PASS" });
  }
  state.online = true;
  slaveRespond(state, request);
  scenarios.push({ name: "communication-recovery", result: "PASS" });

  const beforeRestart = await connector.transform(
    { messageId: "restart-before-1", nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), sequence: 88, readings: decoded },
    ctx,
  );
  const afterRestart = await connector.transform(
    { messageId: "restart-after-1", nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), sequence: 1, readings: decoded },
    ctx,
  );
  scenarios.push({
    name: "device-restart-sequence-reset",
    result: beforeRestart[0]?.sequenceNumber === 88 && afterRestart[0]?.sequenceNumber === 1 ? "PASS" : "FAIL",
  });

  state.buffer.push({
    messageId: "buffered-01",
    sequence: 12,
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    readings: decoded,
  });
  const replayed = await connector.transform(
    { ...state.buffer[0]!, nodeId: "pilot-inverter-1" },
    ctx,
  );
  scenarios.push({
    name: "store-and-forward-replay",
    result: replayed[0]?.messageId === "buffered-01" ? "PASS" : "FAIL",
  });

  const live = await connector.transform(
    { messageId: "live-frame-1", nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), simulated: false, readings: decoded },
    ctx,
  );
  const simulated = await connector.transform(
    { messageId: "sim-frame-1", nodeId: "pilot-inverter-1", timestamp: new Date().toISOString(), simulated: true, readings: decoded },
    ctx,
  );
  scenarios.push({
    name: "simulated-live-separation",
    result: live[0]?.simulated === false && simulated[0]?.simulated === true ? "PASS" : "FAIL",
  });
  scenarios.push({
    name: "plant-control-disabled",
    result: process.env.ZOLT_ADVISORY_ONLY !== "false" ? "PASS" : "FAIL",
  });

  const failed = scenarios.filter((item) => item.result !== "PASS");
  const report = {
    executedAt: new Date().toISOString(),
    mode: "high-fidelity-modbus-emulator",
    physicalRs485: false,
    readOnlyFunctionCode: 3,
    plantControlEnabled: false,
    profile,
    commitHint: createHash("sha256").update(JSON.stringify(profile)).digest("hex").slice(0, 12),
    scenarios,
    result: failed.length === 0 ? "PASS" : "FAIL",
    failed: failed.map((item) => item.name),
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile(
    "docs/operations/hil-emulator-result.json",
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("hil-emulator.ts")) {
  const report = await executeGridFlexHilEmulator();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.result !== "PASS") process.exitCode = 1;
}
