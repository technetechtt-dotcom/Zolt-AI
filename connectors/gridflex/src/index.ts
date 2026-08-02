import { TelemetryEnvelopeSchema, type ZoltTelemetryEnvelope } from "@zolt/contracts";
import type { ConnectorContext, ValidationResult, ZoltConnector } from "@zolt/connector-sdk";

type GridFlexPayload={messageId:string;siteId?:string;nodeId:string;assetId?:string;timestamp:string;sequence?:number;readings:Record<string,number|string|boolean>};
export class GridFlexConnector implements ZoltConnector {
 readonly connectorType="gridflex"; readonly connectorVersion="0.1.0"; readonly supportedContractVersions=["1.0"];
 validateConfiguration(c:unknown):ValidationResult{return {valid:typeof c==="object"&&c!==null,errors:[]};}
 validatePayload(p:unknown):ValidationResult{const x=p as Partial<GridFlexPayload>; const errors:string[]=[]; if(!x?.messageId)errors.push("messageId required"); if(!x?.nodeId)errors.push("nodeId required"); if(!x?.timestamp)errors.push("timestamp required"); if(!x?.readings||typeof x.readings!=="object")errors.push("readings required"); return {valid:errors.length===0,errors};}
 async transform(payload:unknown,ctx:ConnectorContext):Promise<ZoltTelemetryEnvelope[]>{ const p=payload as GridFlexPayload; const env={schemaVersion:"1.0" as const,messageId:p.messageId,tenantId:ctx.tenantId,productId:ctx.productId,installationId:ctx.installationId,siteId:p.siteId,deviceId:p.nodeId,assetId:p.assetId,sourceTimestamp:p.timestamp,receivedTimestamp:ctx.receivedAt,sequenceNumber:p.sequence,measurements:Object.entries(p.readings).map(([key,value])=>({key,value,quality:"GOOD" as const}))}; return [TelemetryEnvelopeSchema.parse(env)]; }
 async testConnection(){return {healthy:true,status:"HEALTHY" as const,message:"GridFlex connector ready"};}
 getCapabilities(){return ["telemetry","forecasts","alarms","device-health"]}
}
