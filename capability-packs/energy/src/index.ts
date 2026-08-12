export { telemetryHealthSkill } from "./skills/telemetry-health.js";
export { curtailmentRiskSkill } from "./skills/curtailment-risk.js";
export { createEnergySkill } from "./skills/factory.js";

import { telemetryHealthSkill } from "./skills/telemetry-health.js";
import { curtailmentRiskSkill } from "./skills/curtailment-risk.js";
import { createEnergySkill } from "./skills/factory.js";
import type { ZoltSkill } from "@zolt/capability-sdk";

const generated: ZoltSkill[] = [
  createEnergySkill({ id: "energy.missing-telemetry", type: "MISSING_TELEMETRY", title: "Missing telemetry", metric: "powerKw", threshold: 0, compare: "lt", severity: "HIGH" }),
  createEnergySkill({ id: "energy.communication-health", type: "COMMUNICATION_HEALTH", title: "Communication degraded", metric: "powerKw", threshold: -1, compare: "lt", severity: "HIGH" }),
  createEnergySkill({ id: "energy.sensor-quality", type: "SENSOR_QUALITY", title: "Sensor quality warning", metric: "voltage", threshold: 0, compare: "lt", severity: "MEDIUM" }),
  createEnergySkill({ id: "energy.sensor-drift", type: "SENSOR_DRIFT", title: "Sensor drift suspected", metric: "voltage", threshold: 800, compare: "gt", severity: "MEDIUM", unit: "V" }),
  createEnergySkill({ id: "energy.voltage-anomaly", type: "VOLTAGE_ANOMALY", title: "Voltage anomaly", metric: "voltage", threshold: 440, compare: "gt", severity: "HIGH", unit: "V" }),
  createEnergySkill({ id: "energy.frequency-anomaly", type: "FREQUENCY_ANOMALY", title: "Frequency anomaly", metric: "frequencyHz", threshold: 50.5, compare: "gt", severity: "HIGH", unit: "Hz" }),
  createEnergySkill({ id: "energy.power-factor-anomaly", type: "POWER_FACTOR_ANOMALY", title: "Power factor anomaly", metric: "powerFactor", threshold: 0.8, compare: "lt", severity: "MEDIUM" }),
  createEnergySkill({ id: "energy.export-limit-risk", type: "EXPORT_LIMIT_RISK", title: "Export limit risk", metric: "powerKw", threshold: 120, compare: "gt", severity: "HIGH", unit: "kW" }),
  createEnergySkill({ id: "energy.curtailment-detection", type: "CURTAILMENT_DETECTED", title: "Curtailment detected", metric: "powerKw", threshold: 10, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.curtailment-forecast", type: "CURTAILMENT_FORECAST", title: "Curtailment forecast", metric: "powerKw", threshold: 100, compare: "gt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.production-forecast", type: "PRODUCTION_FORECAST", title: "Production forecast advisory", metric: "powerKw", threshold: 1, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.load-forecast", type: "LOAD_FORECAST", title: "Load forecast advisory", metric: "powerKw", threshold: 1, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.grid-congestion-risk", type: "GRID_CONGESTION_RISK", title: "Grid congestion risk", metric: "powerKw", threshold: 200, compare: "gt", severity: "HIGH", unit: "kW" }),
  createEnergySkill({ id: "energy.inverter-efficiency", type: "INVERTER_EFFICIENCY", title: "Inverter efficiency advisory", metric: "powerKw", threshold: 5, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.inverter-underperformance", type: "INVERTER_UNDERPERFORMANCE", title: "Inverter underperformance", metric: "powerKw", threshold: 20, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.inverter-anomaly", type: "INVERTER_ANOMALY", title: "Inverter anomaly", metric: "temperatureC", threshold: 80, compare: "gt", severity: "HIGH", unit: "C" }),
  createEnergySkill({ id: "energy.asset-underperformance", type: "ASSET_UNDERPERFORMANCE", title: "Asset underperformance", metric: "powerKw", threshold: 15, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.energy-loss-analysis", type: "ENERGY_LOSS", title: "Energy loss analysis", metric: "powerKw", threshold: 50, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.revenue-loss-analysis", type: "REVENUE_LOSS", title: "Revenue loss analysis", metric: "powerKw", threshold: 50, compare: "lt", severity: "MEDIUM", unit: "kW" }),
  createEnergySkill({ id: "energy.battery-health", type: "BATTERY_HEALTH", title: "Battery health advisory", metric: "socPct", threshold: 10, compare: "lt", severity: "HIGH", unit: "%" }),
  createEnergySkill({ id: "energy.battery-dispatch-opportunity", type: "BATTERY_DISPATCH", title: "Battery dispatch opportunity", metric: "socPct", threshold: 80, compare: "gt", severity: "INFO", unit: "%" }),
  createEnergySkill({ id: "energy.storage-opportunity", type: "STORAGE_OPPORTUNITY", title: "Storage opportunity", metric: "powerKw", threshold: 80, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.flexible-load-opportunity", type: "FLEXIBLE_LOAD", title: "Flexible load opportunity", metric: "powerKw", threshold: 90, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.weather-correlation", type: "WEATHER_CORRELATION", title: "Weather correlation advisory", metric: "powerKw", threshold: 1, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.carbon-impact", type: "CARBON_IMPACT", title: "Carbon impact advisory", metric: "powerKw", threshold: 1, compare: "gt", severity: "INFO", unit: "kW" }),
  createEnergySkill({ id: "energy.predictive-maintenance", type: "PREDICTIVE_MAINTENANCE", title: "Predictive maintenance advisory", metric: "temperatureC", threshold: 70, compare: "gt", severity: "MEDIUM", unit: "C" })
];

export const energySkills: ZoltSkill[] = [telemetryHealthSkill, curtailmentRiskSkill, ...generated];
