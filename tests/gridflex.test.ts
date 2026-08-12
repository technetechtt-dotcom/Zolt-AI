import { describe, expect, it } from "vitest";
import { GridFlexConnector } from "../connectors/gridflex/src/index.js";

const connector = new GridFlexConnector();
const context = {
  tenantId: "tenant-1",
  productId: "product-1",
  installationId: "installation-1",
  receivedAt: new Date().toISOString()
};

describe("GridFlex connector 1.0", () => {
  it("maps supported measurements and marks simulated telemetry", async () => {
    const [envelope] = await connector.transform(
      {
        messageId: "gf-live-0001",
        nodeId: "inv-1",
        timestamp: new Date().toISOString(),
        simulated: true,
        firmwareVersion: "1.2.3",
        vendor: "VendorX",
        model: "INV-50",
        communicationHealth: "HEALTHY",
        modbusQuality: "good",
        readings: { ac_power: 12.5, voltage: 400, frequency: 50 }
      },
      context
    );
    expect(envelope.schemaVersion).toBe("1.1");
    expect(envelope.simulated).toBe(true);
    expect(envelope.firmwareVersion).toBe("1.2.3");
    expect(envelope.vendor).toBe("VendorX");
    expect(envelope.measurements.some((item) => item.key === "powerKw")).toBe(true);
    expect(envelope.metadata?.simulated).toBe(true);
  });

  it("rejects malformed inverter payloads", () => {
    const result = connector.validatePayload({ readings: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("marks communication loss as invalid quality", async () => {
    const [envelope] = await connector.transform(
      {
        messageId: "gf-loss-0001",
        nodeId: "inv-1",
        timestamp: new Date().toISOString(),
        communicationHealth: "FAILED",
        readings: { powerKw: 0 }
      },
      context
    );
    expect(envelope.communicationHealth).toBe("FAILED");
    expect(envelope.measurements[0]?.quality).toBe("INVALID");
  });
});
