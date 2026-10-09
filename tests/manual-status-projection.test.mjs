import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildBoard} from '../src/application/board-service.mjs';import {boardConfig} from '../config/board.mjs';
const source=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
test('manual display survives safe projection without changing observed state, acceptance, agent activity or clock',()=>{
 const input=structuredClone(source),before=buildBoard(input,boardConfig,Date.parse('2026-10-08T11:00:00Z'));
 input.tasks[0].manualStatus={version:1,state:'running',updatedAt:'2026-10-08T11:00:00Z',source:'owner_manual',reason:'Owner choice',secret:'not projected'};
 const after=buildBoard(input,boardConfig,Date.parse('2026-10-08T11:00:00Z')),task=after.tasks.find(t=>t.id===input.tasks[0].id),original=before.tasks.find(t=>t.id===task.id);
 assert.equal(task.manualStatus.state,'running');assert.equal(task.state,original.state);assert.equal(task.observedAt,original.observedAt);assert.deepEqual(task.verification,original.verification);assert.deepEqual(after.agents,before.agents);assert.deepEqual(after.agentSummary,before.agentSummary);assert.deepEqual(after.counts,before.counts);assert(!Object.hasOwn(task.manualStatus,'secret'));
});
test('untrusted or malformed manual projection metadata is omitted',()=>{for(const manualStatus of [{version:1,state:'completed',updatedAt:'2026-10-08T11:00:00Z',source:'model_guess'},{version:0,state:'running',updatedAt:'2026-10-08T11:00:00Z',source:'owner_manual'}]){const input=structuredClone(source);input.tasks[0].manualStatus=manualStatus;assert(!buildBoard(input,boardConfig).tasks.find(t=>t.id===input.tasks[0].id).manualStatus);}});
