import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDispatchJobs,dispatchProjectionMetadata} from '../src/application/dispatch-projection.mjs';
const executionAt='2026-10-07T16:00:00.000Z',uncertaintyAt='2026-10-07T17:00:00.000Z';
const snapshot={schemaVersion:'dot-board.snapshot/2',importedAt:'2026-10-07T00:00:00.000Z',tasks:[{id:'existing',title:'Existing task',project:'Existing project',state:'paused',observedAt:'2026-10-06T10:00:00.000Z'}],agents:[{id:'existing-agent',name:'Existing role',activity:{state:'completed',observedAt:'2026-10-06T11:00:00.000Z'},taskIds:['existing']}]};
const proof=observedAt=>({kind:'tool_result',observedAt,source:'Synthetic test runner',step:'Synthetic check produced output',reference:'synthetic-proof'});
const base={id:'job-1',rootJobId:'job-1',requestId:'request-1',projectId:'project-1',ownerId:'owner',threadId:'synthetic-thread',state:'uncertain',holdsSlot:true,version:3,priority:1,updatedAt:uncertaintyAt,executionObservedAt:executionAt,executionEvidence:proof(executionAt),summary:'Dispatch outcome requires reconciliation'};
const registry=[{id:'project-1',name:'Synthetic project'}];
const project=jobs=>projectDispatchJobs(snapshot,jobs,jobs.map(j=>({id:j.requestId,body:'Synthetic task',ownerId:'owner'})),registry,{now:Date.parse('2026-10-07T17:02:00.000Z')});
const role=result=>result.agents.find(a=>a.id==='dispatch-agent:job-1');

test('uncertain execution is unknown at its actual observation time, retaining last execution evidence separately',()=>{
 const result=project([{...base}]);assert.equal(role(result).activity.state,'unknown');assert.equal(role(result).activity.observedAt,uncertaintyAt);assert.equal(role(result).source.observedAt,uncertaintyAt);assert.equal(dispatchProjectionMetadata(result).records[0].lastExecutionObservedAt,executionAt);assert.equal(result.tasks.at(-1).state,'blocked');assert.equal(dispatchProjectionMetadata(result).records[0].holdsSlot,true);
});
test('an uncertainty report does not invent previous execution evidence or an unbound Agent',()=>{
 let result=project([{...base,executionObservedAt:null,executionEvidence:null}]);assert.equal(role(result).activity.state,'unknown');assert.equal(role(result).activity.observedAt,uncertaintyAt);assert.equal(dispatchProjectionMetadata(result).records[0].lastExecutionObservedAt,null);
 result=project([{...base,threadId:null,executionObservedAt:null,executionEvidence:null}]);assert.equal(role(result),undefined);assert.equal(result.tasks.at(-1).state,'blocked');
});
test('newer uncertainty supersedes prior completion for the same actual thread in either input order',()=>{
 const previous={...base,id:'earlier',requestId:'prior-request',state:'completed',holdsSlot:false,executionObservedAt:executionAt,updatedAt:executionAt,summary:'Earlier turn completed'};
 for(const jobs of [[previous,base],[base,previous]]){const result=project(jobs);assert.equal(role(result).activity.state,'unknown');assert.equal(role(result).activity.observedAt,uncertaintyAt);assert.equal(role(result).source.observedAt,uncertaintyAt);assert.equal(role(result).taskIds.length,2);assert.equal(result.agents.filter(a=>a.id==='dispatch-agent:job-1').length,1);}
});
test('a later verified execution resolves older uncertainty; equal timestamps remain conservative',()=>{
 const later={...base,id:'later',requestId:'later-request',state:'running',executionEvidence:proof('2026-10-07T17:01:00.000Z'),executionObservedAt:'2026-10-07T17:01:00.000Z',updatedAt:'2026-10-07T17:01:00.000Z',summary:'A verified new turn is running'};
 for(const jobs of [[later,base],[base,later]])assert.equal(role(project(jobs)).activity.state,'running');
 const same={...later,executionEvidence:proof(uncertaintyAt),executionObservedAt:uncertaintyAt,updatedAt:uncertaintyAt};for(const jobs of [[same,base],[base,same]])assert.equal(role(project(jobs)).activity.state,'unknown');
});
test('confirmed checkpoint remains waiting and original cards, observations and snapshot timestamp are unchanged',()=>{
 const before=structuredClone(snapshot);const result=project([{...base,state:'blocked',holdsSlot:false,executionObservedAt:uncertaintyAt,summary:'Executor confirmed no active writer at a safe checkpoint'}]);assert.equal(role(result).activity.state,'waiting');assert.equal(role(result).activity.observedAt,uncertaintyAt);assert.deepEqual(snapshot,before);assert.deepEqual(result.tasks[0],before.tasks[0]);assert.deepEqual(result.agents[0],before.agents[0]);assert.equal(result.importedAt,before.importedAt);
});
test('mixed whole-second and fractional timestamp formats compare by instant',()=>{
 const previous={...base,id:'prior',requestId:'prior-request',state:'completed',executionObservedAt:'2026-10-07T17:00:00Z',updatedAt:'2026-10-07T17:00:00Z'};
 const uncertain={...base,updatedAt:'2026-10-07T17:00:00.500Z'};
 for(const jobs of [[previous,uncertain],[uncertain,previous]])assert.equal(role(project(jobs)).activity.state,'unknown');
});
test('claimed and dispatching continuations do not inherit a waiting label from an earlier checkpoint',()=>{
 for(const state of ['claimed','dispatching']){const r=project([{...base,state}]);assert.equal(role(r).activity.state,'unknown');assert.equal(role(r).activity.observedAt,uncertaintyAt);assert.equal(dispatchProjectionMetadata(r).records[0].lastExecutionObservedAt,executionAt);}
});
test('queue metadata reports the latest instant across timestamp formats',()=>{
 const a={...base,updatedAt:'2026-10-07T17:00:00Z'},b={...base,id:'later',requestId:'later-request',updatedAt:'2026-10-07T17:00:00.500Z'};assert.equal(dispatchProjectionMetadata(project([a,b])).latestObservedAt,b.updatedAt);
});
