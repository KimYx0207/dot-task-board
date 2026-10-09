import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const source=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
function setup(t){const db=sqliteIntakeFixture();t.after(()=>db.close());const snapshot=structuredClone(source),task=snapshot.tasks[0];task.state='unknown';const env={DB:db.binding,DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:'synthetic-owner',DOT_BOARD_AUDIENCE:'https://example.com',DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'p',name:task.project,aliases:[],executionState:'deferred'}]),DOT_BOARD_SNAPSHOT:JSON.stringify(snapshot)};const entry=createSitesPrivateEntry();const call=(path,{owner='synthetic-owner',body,origin='https://example.com'}={})=>entry.fetch(new Request('https://example.com'+path,{method:body?'POST':'GET',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),...(body?{'content-type':'application/json',...(origin?{origin}:{})}:{})},body:body?JSON.stringify(body):undefined}),env);return {db,task,call};}
test('Sites owner manual status survives reload independently of observed result and execution',async t=>{const c=setup(t),path='/api/tasks/'+encodeURIComponent(c.task.id)+'/status',before=await(await c.call('/api/board')).json();assert.equal((await(await c.call(path)).json()).version,0);
 const body={eventId:'manual-synthetic-running',expectedVersion:0,state:'running',reason:'Owner display choice'};const response=await c.call(path,{body});assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.version,1);assert.equal(saved.duplicate,false);
 assert.equal((await(await c.call(path,{body})).json()).duplicate,true);
 const after=await(await c.call('/api/board')).json(),updated=after.tasks.find(x=>x.id===c.task.id);assert.equal(updated.manualStatus.state,'running');assert.equal(updated.state,'unknown');assert.deepEqual(after.agents,before.agents);assert.deepEqual(after.counts,before.counts);assert.equal(c.db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_jobs').get().n,0);
 const stale=await c.call(path,{body:{...body,eventId:'different',state:'completed'}});assert.equal(stale.status,409);
});
test('Sites manual pause enforces task control and refuses unauthorized resume, wrong-owner and CSRF',async t=>{const c=setup(t),path='/api/tasks/'+encodeURIComponent(c.task.id)+'/status',body={eventId:'manual-synthetic-pause',expectedVersion:0,state:'paused'};
 assert.equal((await c.call(path,{owner:null})).status,401);assert.equal((await c.call(path,{owner:'wrong',body})).status,403);assert.equal((await c.call(path,{body,origin:null})).status,403);
 assert.equal((await c.call(path,{body})).status,200);const current=await(await c.call(path)).json();assert.equal(current.executionControl.state,'paused');assert.equal(current.version,1);
 assert.equal((await c.call(path,{body:{eventId:'manual-synthetic-resume',expectedVersion:1,state:'running'}})).status,409);
 const control=c.db.db.prepare("SELECT state FROM dispatch_controls WHERE owner_id=? AND scope='task' AND target_id=?").get('synthetic-owner',c.task.id);assert.equal(control.state,'paused');
});

test('manual completed display survives owner reload without granting another owner access or acceptance',async t=>{
 const c=setup(t),path='/api/tasks/'+encodeURIComponent(c.task.id)+'/status',before=await(await c.call('/api/board')).json();
 const response=await c.call(path,{body:{eventId:'manual-completed-display',expectedVersion:0,state:'completed',reason:'Owner completed collection'}});assert.equal(response.status,200);
 const after=await(await c.call('/api/board')).json(),original=before.tasks.find(x=>x.id===c.task.id),task=after.tasks.find(x=>x.id===c.task.id);assert.equal(task.displayState,'completed');assert.equal(after.displayCounts.completed,1);assert.equal(task.state,original.state);assert.deepEqual(task.verification,original.verification);assert.deepEqual(after.agents,before.agents);assert.deepEqual(after.counts,before.counts);
 assert.equal((await c.call('/api/board',{owner:'other-owner'})).status,403);assert.equal((await c.call(path,{owner:'other-owner'})).status,403);assert.equal(c.db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_jobs').get().n,0);
 assert.equal((await c.call('/task-display.js')).headers.get('content-type'),'text/javascript; charset=utf-8');
});
