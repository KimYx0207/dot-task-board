import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionDispatch} from '../src/domain/dispatch-queue.mjs';

const now='2026-10-08T13:00:00.000Z';
const job={id:'synthetic-job',requestId:'synthetic-current-request',state:'uncertain',holdsSlot:true,version:4,threadId:'original-thread',turnId:null,dispatchKey:'current-dispatch',environmentType:'existing_thread',environmentId:null,createdAt:'2026-10-08T12:32:38.000Z',updatedAt:'2026-10-08T12:34:59.000Z',executionEvidence:null,executionObservedAt:null};
const identity={summary:'Synthetic recovery evidence test',dispatchKey:job.dispatchKey,threadId:job.threadId,environment:{type:'existing_thread',id:null}};
const oldEvidence={kind:'tool_result',observedAt:'2026-10-08T10:26:28.000Z',source:'Synthetic old executor turn',step:'Earlier request finished and had no active writer',reference:'synthetic-old-terminal-item',active:false,terminal:true};

test('SAFETY REQUIREMENT: UNKNOWN checkpoint requires actual reconciliation evidence, not booleans alone',()=>{
  assert.throws(()=>transitionDispatch(job,'checkpoint',{...identity,noActiveWriter:true,reconciliation:'confirmed_no_active_writer',nextState:'queued'},now));
});

test('SAFETY REQUIREMENT: UNKNOWN checkpoint rejects an earlier-request terminal receipt',()=>{
  assert.throws(()=>transitionDispatch(job,'checkpoint',{...identity,noActiveWriter:true,reconciliation:'confirmed_no_active_writer',reconciliationEvidence:'Synthetic receipt from old request',executionEvidence:oldEvidence,nextState:'queued'},now));
});

test('SAFETY REQUIREMENT: current request cannot finish from an old turn and a pre-dispatch result',()=>{
  assert.throws(()=>{const bound={...job,...transitionDispatch(job,'bind',{...identity,verified:true,turnId:'synthetic-old-turn'},now)};transitionDispatch(bound,'complete',{...identity,turnId:'synthetic-old-turn',noActiveWriter:true,executionEvidence:oldEvidence},now);});
});

test('CONTROL: wrong dispatch identity is rejected',()=>{
  assert.throws(()=>transitionDispatch(job,'checkpoint',{...identity,dispatchKey:'different-dispatch',noActiveWriter:true,reconciliation:'confirmed_no_active_writer',nextState:'queued'},now),{code:'dispatch_binding_conflict'});
});
