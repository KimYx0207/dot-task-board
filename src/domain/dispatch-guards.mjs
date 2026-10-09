import {queueError,queueId} from './dispatch-queue.mjs';
export const executionStates=Object.freeze(['active','paused','deferred','canceled']);
export function executionState(value='active'){
 if(!executionStates.includes(value))queueError('invalid_execution_policy','Unknown execution control',400);
 return value;
}
// Stable canonical resource identities must be supplied by the trusted host, never inferred from titles.
export function dispatchResources(value=[]){
 if(!Array.isArray(value)||value.length>32)queueError('invalid_resources','At most 32 resource declarations are allowed',400);
 const keys=value.map(resource=>{
  if(!resource||Object.keys(resource).some(k=>!['kind','id'].includes(k))||!['browser','foreground','gpu','repository','service'].includes(resource.kind))queueError('invalid_resources','Invalid exclusive resource declaration',400);
  return resource.kind+':'+queueId(resource.id);
 });
 if(new Set(keys).size!==keys.length)queueError('invalid_resources','Duplicate exclusive resource',400);
 return keys.sort();
}
