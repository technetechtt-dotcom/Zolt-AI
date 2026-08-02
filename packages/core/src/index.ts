import { createHash, randomUUID } from "node:crypto";
import type { RecommendationStatus, ZoltRecommendation } from "@zolt/contracts";
import type { ZoltContext, ZoltExecutionContext, ZoltSkill } from "@zolt/capability-sdk";

const transitions:Record<RecommendationStatus,RecommendationStatus[]>={
 PROPOSED:["ACKNOWLEDGED","APPROVED","REJECTED","EXPIRED","SUPERSEDED"], ACKNOWLEDGED:["APPROVED","REJECTED","EXPIRED","RESOLVED"], APPROVED:["EXPIRED","RESOLVED"], REJECTED:[], EXPIRED:[], SUPERSEDED:[], RESOLVED:[]
};
export function assertTransition(from:RecommendationStatus,to:RecommendationStatus):void { if(!transitions[from].includes(to)) throw new Error(`INVALID_RECOMMENDATION_TRANSITION:${from}->${to}`); }
export function deduplicationKey(parts:Record<string,string|undefined>):string { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
export class AnalysisOrchestrator {
 constructor(private readonly skills:ZoltSkill[]){}
 async analyse(context:ZoltContext):Promise<ZoltRecommendation[]> {
  const advisoryOnly = process.env.ZOLT_ADVISORY_ONLY !== "false";
  const minConfidence = Number(process.env.ZOLT_MIN_CONFIDENCE ?? "0");
  const execution:ZoltExecutionContext={runId:randomUUID(),correlationId:randomUUID(),advisoryOnly:true};
  if (!advisoryOnly) {
    throw new Error("SAFETY_POLICY_VIOLATION");
  }
  const output:ZoltRecommendation[]=[];
  for(const skill of this.skills.filter(s=>s.supports(context))){
   try {
    const result=await skill.analyse(context,execution);
    if(result.recommendation){
      if (result.recommendation.confidence < minConfidence) {
        continue;
      }
      const now=new Date().toISOString();
      output.push({...result.recommendation,id:randomUUID(),status:"PROPOSED",inputSnapshotId:randomUUID(),createdAt:now,updatedAt:now});
    }
   } catch (error) {
    console.error("SKILL_EXECUTION_FAILED", {
      skillId: skill.id,
      error: error instanceof Error ? error.message : String(error)
    });
   }
  }
  return output;
 }
}
export function assertAdvisoryOnly(execution:{advisoryOnly:boolean}):void { if(execution.advisoryOnly!==true) throw new Error("SAFETY_POLICY_VIOLATION"); }
