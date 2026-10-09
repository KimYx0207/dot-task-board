import {safeText} from '../domain/snapshot.mjs';
import {executionEvidenceView} from '../domain/execution-evidence.mjs';
const taskState={queued:'queued',claimed:'queued',dispatching:'queued',assigned:'queued',running:'running',blocked:'blocked',uncertain:'blocked',completed:'completed',failed:'blocked',canceled:'canceled'};
function observeAgent(job,summary,activity){
 const uncertain=['uncertain','claimed','dispatching'].includes(job.state);
 const observedAt=uncertain?job.updatedAt:job.state==='running'?activity.lastExecutionObservedAt:job.state==='assigned'?null:job.executionObservedAt;
 const state=uncertain||!observedAt?'unknown':job.state==='running'?activity.effectiveState:['completed','failed'].includes(job.state)?'completed':'waiting';
 return {state,summary,observedAt};
}
function newerObservation(next,current){
 const nextTime=Date.parse(next.observedAt),currentTime=Date.parse(current.observedAt);
 return Number.isFinite(nextTime)&&(!Number.isFinite(currentTime)||nextTime>currentTime||nextTime===currentTime&&next.state==='unknown'&&current.state!=='unknown');
}
const dispatchProjectionKey=Symbol('verified-dispatch-projection');
export function dispatchProjectionMetadata(input){return input?.[dispatchProjectionKey]??null;}
export function projectDispatchJobs(snapshot,jobs,requests,registry,{maxTasks=200,maxAgents=100,totalJobs=jobs.length,now=Date.now(),projectTotals=null}={}){
 const tasks=[...snapshot.tasks],agents=(snapshot.agents??[]).map(a=>({...a,taskIds:[...(a.taskIds??[])],activity:{...a.activity}})),knownTasks=new Set(tasks.map(t=>t.id)),knownAgents=new Map(agents.map(a=>[a.id,a]));
 const selected=[],agentObservationOrder=new Map(agents.map(agent=>[agent.id,agent.activity]));
 for(const job of jobs){
  if(job.state==='canceled')continue;
  if(tasks.length>=maxTasks)break;
  const project=registry.find(p=>p.id===job.projectId),request=requests.find(r=>r.id===job.requestId);if(!project||!request||request.ownerId&&request.ownerId!==job.ownerId)continue;
  const id='dispatch:'+job.id;if(knownTasks.has(id))continue;knownTasks.add(id);
  const activityView=executionEvidenceView(job,now);
  const summary=safeText(job.summary,600)||'执行记录待补充',title=safeText(request.body,80).split('\n')[0]||'项目需求';
  tasks.push({id,title,taskNumber:job.taskNumber??null,project:project.name,state:job.state==='running'?activityView.effectiveState:taskState[job.state]??'unknown',stage:job.state==='uncertain'?'派发结果待核对；保留执行名额':job.state==='assigned'?'已建立子任务；等待执行确认':job.state==='queued'?'等待可用执行名额':job.state,ownerRole:job.threadId?'项目执行者':'尚未分派',observedAt:job.state==='running'?activityView.lastExecutionObservedAt:job.updatedAt,observation:summary,blocker:['blocked','uncertain','failed'].includes(job.state)?summary:'',nextAction:job.state==='uncertain'?'核对原派发结果，确认没有活动写入者后再推进':job.state==='queued'?`队列优先级 ${job.priority}；等待执行名额，不打断正在运行的任务`:'',evidence:job.evidenceLinks??[],verification:{sourceReview:{state:'unknown'},deployment:{state:'unknown'},businessAcceptance:{state:'unknown'}}});
  selected.push({id,requestId:job.requestId,taskNumber:job.taskNumber??null,registeredAt:job.createdAt??null,queueVersion:job.version,phase:job.state,...activityView,priority:job.priority,holdsSlot:job.holdsSlot,threadBound:Boolean(job.threadId),continuation:Boolean(job.continuationOf),observedAt:job.updatedAt,lastLifecycleObservedAt:job.executionObservedAt??null});
  if(!job.threadId)continue;
  const agentId='dispatch-agent:'+job.rootJobId,old=knownAgents.get(agentId),activity=observeAgent(job,summary,activityView),agentSource={label:job.state==='uncertain'?'派发结果待核对':job.state==='running'?(activityView.evidenceSource??'执行证据未记录'):'执行线程绑定与回执',observedAt:activity.observedAt};
  // Lifecycle ordering and execution observation are different facts. A later
  // unobserved turn must supersede an older completed turn without inventing an
  // execution timestamp for the new turn.
  const observationOrder={state:activity.state,observedAt:job.updatedAt};
  if(old){old.taskIds=[...new Set([...old.taskIds,id])];if(newerObservation(observationOrder,agentObservationOrder.get(agentId))){old.activity=activity;old.source=agentSource;agentObservationOrder.set(agentId,observationOrder);}continue;}
  if(agents.length>=maxAgents)continue;
  const agent={id:agentId,name:'项目执行者',type:'subagent',kind:'worker',role:'按已确认需求执行',parentAgentId:null,relationshipState:'unknown',projectNames:[project.name],taskIds:[id],responsibility:'执行已认领的项目需求',activity,source:agentSource};agents.push(agent);knownAgents.set(agentId,agent);agentObservationOrder.set(agentId,observationOrder);
 }
 const result={...snapshot,tasks,agents};Object.defineProperty(result,dispatchProjectionKey,{value:Object.freeze({projectTotals,taskCount:selected.length,totalQueueRecords:totalJobs,omittedQueueRecords:Math.max(0,totalJobs-selected.length),truncated:jobs.length<totalJobs||selected.length<jobs.filter(j=>j.state!=='canceled').length,latestObservedAt:selected.map(j=>j.observedAt).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)??null,records:selected}),enumerable:true});return result;
}
