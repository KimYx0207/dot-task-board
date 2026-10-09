/** Decode the read schema observed 2026-10-08. The platform response does not
 * include environment identity or completion acceptance; neither is invented.
 * lookupBinding and acceptResult are host policy capabilities, not task text.
 */
export function createCloudThreadDecoder({lookupBinding,inspectExecution=async()=>null,acceptResult=async()=>null,clock=()=>new Date().toISOString()}){
 return async (raw,input)=>{
  const binding=await lookupBinding({ownerId:input.ownerId,requestId:input.requestId,threadId:input.threadId});
  if(binding?.verified!==true||binding.threadId!==input.threadId||binding.environment?.type!==input.environment.type||(binding.environment?.id??null)!==(input.environment.id??null)||raw.threadId!==input.threadId||!raw.latestTurn?.id)return null;
  const turn=raw.latestTurn,turnTerminal=['completed','failed','interrupted'].includes(turn.status);
  const result=(raw.items??[]).find(x=>x.turnId===turn.id&&x.role==='assistant'&&typeof x.text==='string'&&x.text.trim());
  const accepted=turnTerminal&&result?await acceptResult({ownerId:input.ownerId,requestId:input.requestId,threadId:input.threadId,turnId:turn.id,status:turn.status,result:{id:result.id,text:result.text}}):null;
  const execution=turnTerminal?await inspectExecution({ownerId:input.ownerId,requestId:input.requestId,threadId:input.threadId,turnId:turn.id,status:turn.status,raw}):null;
  const noActiveWriter=Boolean(turnTerminal&&(execution?.verified===true&&execution?.noActiveWriter===true||accepted?.verified===true&&accepted?.noActiveWriter===true));
  // Continuation safety and business acceptance are separate decisions.
  // An acceptance decision must explicitly identify checked scope and pending
  // checks. Merely finishing an assistant message does not satisfy this contract.
  const businessCompleted=Boolean(turn.status==='completed'&&accepted?.verified===true&&accepted?.noActiveWriter===true&&accepted?.outcome==='completed'&&accepted?.completedScope?.length&&Array.isArray(accepted.pendingChecks)&&accepted.pendingChecks.length===0);
  const businessFailed=Boolean(turnTerminal&&accepted?.verified===true&&accepted?.noActiveWriter===true&&accepted?.outcome==='failed'&&accepted?.completedScope?.length&&Array.isArray(accepted.pendingChecks));
  const evidence=(businessCompleted||businessFailed)?{kind:'tool_result',observedAt:clock(),source:'cloud_threads.read',step:accepted.completedScope.join('; ').slice(0,600),reference:`cloud_threads.read:${raw.threadId}:${turn.id}:${result.id}`,active:false,terminal:true}:null;
  return {threadId:raw.threadId,turnId:turn.id,environment:binding.environment,status:turn.status,active:noActiveWriter?false:turn.status==='inProgress'?true:null,terminal:turnTerminal,businessCompleted,businessFailed,completedScope:accepted?.completedScope??[],pendingChecks:accepted?.pendingChecks??['Task acceptance has not been verified'],executionEvidence:evidence};
 };
}
