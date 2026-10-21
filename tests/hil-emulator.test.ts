import { describe, expect, it } from "vitest";
import { executeGridFlexHilEmulator } from "../scripts/hil-emulator.js";

describe("GridFlex high-fidelity HIL emulator", () => {
  it("passes every mandatory scenario without enabling plant control", async () => {
    const report = await executeGridFlexHilEmulator();
    expect(report.physicalRs485).toBe(false);
    expect(report.plantControlEnabled).toBe(false);
    expect(report.readOnlyFunctionCode).toBe(3);
    expect(report.result).toBe("PASS");
  });
});
