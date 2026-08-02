import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
export interface ConnectorContext { tenantId:string; productId:string; installationId:string; receivedAt:string; }
export interface ValidationResult { valid:boolean; errors:string[]; }
export interface ConnectorHealthResult { healthy:boolean; status:"HEALTHY"|"DEGRADED"|"FAILED"; message:string; }
export interface ZoltConnector {
  readonly connectorType:string; readonly connectorVersion:string; readonly supportedContractVersions:string[];
  validateConfiguration(configuration:unknown):ValidationResult;
  validatePayload(payload:unknown):ValidationResult;
  transform(payload:unknown, context:ConnectorContext):Promise<ZoltTelemetryEnvelope[]>;
  testConnection():Promise<ConnectorHealthResult>;
  getCapabilities():string[];
}
