import {normalizeSnapshot,safeText,timestamp,SnapshotError} from './snapshot.mjs';
import {intakeDigest} from './intake.mjs';
const overlayMetadataKey=Symbol('verified-task-status-overlay');
const overlayFields={state:30,stage:100,ownerRole:80,observation:600,blocker:400,nextAction:400,nextOwnerRole:80,retainedDecision:300};
const overlayRecord=value=>value&&typeof value==='object'&&!Array.isArray(value);
const overlayExactKeys=(value,allowed)=>overlayRecord(value)&&Object.keys(value).every(key=>allowed.includes(key));
const overlayReject=()=>{throw new SnapshotError('invalid_status_overlay');};
export function taskStatusOverlayMetadata(input){return input?.[overlayMetadataKey]?.public??null;}
export async function applyTaskStatusOverlay(input,overlay,config,now=Date.now()){
  if(overlay===null||overlay===undefined)return input;
  const policy=config.taskStatusOverlay;
  if(!overlayExactKeys(overlay,['schemaVersion','version','updates'])||overlay.schemaVersion!=='dot-board.task-status-overlay/1'||!Number.isSafeInteger(overlay.version)||overlay.version<1||!Array.isArray(overlay.updates)||!overlay.updates.length||overlay.updates.length>20)overlayReject();
  if(!policy||overlay.version!==policy.version||!/^[a-f0-9]{64}$/.test(policy.sha256??''))overlayReject();
  const digest=await intakeDigest(overlay);
  if(digest!==policy.sha256)overlayReject();
  const previous=input?.[overlayMetadataKey];
  if(previous){if(previous.version===overlay.version&&previous.digest===digest)return input;overlayReject();}
  const normalized=normalizeSnapshot(input,config),seen=new Set(),changes=[];
  for(const change of overlay.updates){
    if(!overlayExactKeys(change,['taskId','expected','observedAt','sourceLabel','set','hideFromBoard'])||typeof change.taskId!=='string'||seen.has(change.taskId)||!overlayExactKeys(change.expected,['title','state'])||!overlayExactKeys(change.set,Object.keys(overlayFields))||!Object.keys(change.set).length)overlayReject();
    if(Object.hasOwn(change,'hideFromBoard')&&typeof change.hideFromBoard!=='boolean')overlayReject();
    if(change.hideFromBoard===true&&change.set.state!=='canceled')overlayReject();
    seen.add(change.taskId);
    const index=normalized.tasks.findIndex(task=>task.id===change.taskId),task=normalized.tasks[index];
    if(!task||change.expected.title!==task.title||change.expected.state!==task.state)overlayReject();
    const observed=timestamp(change.observedAt);
    if(!observed||Date.parse(observed)>now+300000||(task.observedAt&&Date.parse(observed)<Date.parse(task.observedAt)))overlayReject();
    if(typeof change.sourceLabel!=='string'||!change.sourceLabel||safeText(change.sourceLabel,120)!==change.sourceLabel)overlayReject();
    for(const [key,value] of Object.entries(change.set)){
      if(typeof value!=='string'||safeText(value,overlayFields[key])!==value)overlayReject();
      if(key==='state'&&!Object.hasOwn(config.states,value))overlayReject();
    }
    if(!change.set.observation)overlayReject();
    changes.push({index,hidden:change.hideFromBoard===true,fields:{...change.set,observedAt:observed}});
  }
  const tasks=input.tasks.map(task=>({...task}));
  for(const {index,fields} of changes)Object.assign(tasks[index],fields);
  const hiddenIndices=new Set(changes.filter(change=>change.hidden).map(change=>change.index));
  const result={...input,tasks:tasks.filter((_,index)=>!hiddenIndices.has(index))};
  const metadata=Object.freeze({version:overlay.version,digest,public:Object.freeze({taskCount:changes.filter(change=>!change.hidden).length,hiddenTaskCount:hiddenIndices.size,latestObservedAt:overlay.updates.filter(change=>!change.hideFromBoard).map(x=>x.observedAt).sort().at(-1)??null,scope:'selected_task_updates',agentRecordsUpdated:false})});
  Object.defineProperty(result,overlayMetadataKey,{value:metadata,enumerable:true});
  return result;
}
