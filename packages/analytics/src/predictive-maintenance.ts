export interface PredictiveMaintenanceInput {
  temperatureTrendCPerHour: number;
  powerDeratingPct: number;
  repeatedFaultCount: number;
  dcAcImbalancePct: number;
  communicationsLossPct: number;
  voltageAnomalyCount: number;
  frequencyAnomalyCount: number;
  efficiencyDeteriorationPct: number;
  maintenanceOverdueDays: number;
}

export interface PredictiveMaintenanceResult {
  healthScore: number;
  failureProbability: number;
  expectedHoursToMaintenance: number;
  evidence: string[];
  advisoryOnly: true;
}

export function scorePredictiveMaintenance(
  input: PredictiveMaintenanceInput,
): PredictiveMaintenanceResult {
  const evidence: string[] = [];
  let risk = 0;
  if (input.temperatureTrendCPerHour > 0.8) {
    risk += 0.18;
    evidence.push("temperature trend rising");
  }
  if (input.powerDeratingPct > 8) {
    risk += 0.16;
    evidence.push("power derating above 8%");
  }
  if (input.repeatedFaultCount >= 3) {
    risk += 0.2;
    evidence.push(`repeated fault codes (${input.repeatedFaultCount})`);
  }
  if (input.dcAcImbalancePct > 5) {
    risk += 0.12;
    evidence.push("DC/AC imbalance");
  }
  if (input.communicationsLossPct > 10) {
    risk += 0.1;
    evidence.push("communications degradation");
  }
  if (input.voltageAnomalyCount + input.frequencyAnomalyCount > 4) {
    risk += 0.1;
    evidence.push("voltage/frequency anomalies");
  }
  if (input.efficiencyDeteriorationPct > 4) {
    risk += 0.1;
    evidence.push("efficiency deterioration");
  }
  if (input.maintenanceOverdueDays > 0) {
    risk += Math.min(0.15, input.maintenanceOverdueDays / 180);
    evidence.push("maintenance overdue");
  }
  const failureProbability = Number(Math.min(0.95, risk).toFixed(3));
  const healthScore = Number((100 * (1 - failureProbability)).toFixed(1));
  const expectedHoursToMaintenance = Number(
    Math.max(4, (1 - failureProbability) * 24 * 90).toFixed(0),
  );
  return {
    healthScore,
    failureProbability,
    expectedHoursToMaintenance,
    evidence: evidence.length ? evidence : ["no elevated maintenance signals"],
    advisoryOnly: true,
  };
}
