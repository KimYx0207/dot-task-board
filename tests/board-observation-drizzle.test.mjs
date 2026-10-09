import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createD1BoardObservationOutbox} from '../src/adapters/d1-board-observation-outbox.mjs';
import {createD1BoardObservationStore} from '../src/adapters/d1-board-observations.mjs';
import {createBoardObservationService} from '../src/application/board-observation-service.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const journal=JSON.parse(read('drizzle/meta/_journal.json'));
const clock=()=> '2026-10-08T07:00:00.000Z';
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  for(const entry of journal.entries)for(const statement of read('drizzle/'+entry.tag+'.sql').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))db.exec(statement);
  function prepare(sql,args=[]){const execute=()=>{const statement=db.prepare(sql);if(/^\s*SELECT\b/i.test(sql))return {results:statement.all(...args),meta:{changes:0}};return {results:[],meta:{changes:Number(statement.run(...args).changes)}};};return {bind:(...args)=>prepare(sql,args),run:async()=>execute(),all:async()=>execute(),first:async()=>execute().results[0]??null,execute};}
  const binding={prepare,batch:async statements=>{db.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,binding};
}
const insertObservation=(db,owner='owner-a',id='source-event')=>db.prepare('INSERT INTO board_observation_events(owner_id,task_id,event_id,payload_digest,version,source_observed_at,source_observed_ms,observation_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(owner,'task-a',id,'a'.repeat(64),1,clock(),Date.parse(clock()),'{}',clock());
const insertOutbox=(db,{owner='owner-a',id='outbox-event',source='source-event',status='partial',state='pending',attempts=0,token=null,until=null}={})=>db.prepare('INSERT INTO board_observation_outbox(owner_id,event_id,observation_event_id,observation_digest,project_id,task_id,status,occurred_at,created_at,state,attempts,next_attempt_at,lease_token,lease_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(owner,id,source,'a'.repeat(64),'project-a','task-a',status,clock(),clock(),state,attempts,clock(),token,until);

test('all five original SQL migrations and metadata snapshots retain exact bytes',()=>{
  const manifest=read('docs/DRIZZLE_BASE_SHA256SUMS').trim().split('\n');
  for(const line of manifest){const match=line.match(/^([a-f0-9]{64})\s+(.+)$/);assert.ok(match);if(match[2]==='drizzle/meta/_journal.json')continue;assert.equal(createHash('sha256').update(readFileSync(new URL(match[2],root))).digest('hex'),match[1],match[2]);}
  assert(journal.entries.length>=6);assert.deepEqual(journal.entries.slice(0,6).map(row=>row.idx),[0,1,2,3,4,5]);assert.equal(journal.entries[5].tag,'0005_board_observation_outbox');
});
test('new schema snapshot adds only the outbox table and retains previous table definitions',()=>{
  const previous=JSON.parse(read('drizzle/meta/0004_snapshot.json')),next=JSON.parse(read('drizzle/meta/0005_snapshot.json'));
  assert.equal(next.prevId,previous.id);for(const [name,value] of Object.entries(previous.tables))assert.deepEqual(next.tables[name],value,name);
  assert.deepEqual(Object.keys(next.tables).filter(name=>!Object.hasOwn(previous.tables,name)),['board_observation_outbox']);
  const table=next.tables.board_observation_outbox;assert.equal(Object.keys(table.columns).length,15);assert.equal(Object.keys(table.foreignKeys).length,1);assert.equal(Object.keys(table.checkConstraints).length,5);
});
test('all six migrations apply cleanly and outbox has the composite owner/source-event foreign key',t=>{
  const {db}=fixture(t);const fk=db.prepare('PRAGMA foreign_key_list(board_observation_outbox)').all();assert.equal(fk.length,2);assert.deepEqual(fk.map(row=>[row.table,row.from,row.to]),[['board_observation_events','owner_id','owner_id'],['board_observation_events','observation_event_id','event_id']]);
  insertObservation(db);assert.throws(()=>insertOutbox(db,{owner:'owner-b'}),/FOREIGN KEY constraint failed/);assert.throws(()=>insertOutbox(db,{source:'missing-source'}),/FOREIGN KEY constraint failed/);insertOutbox(db);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('Drizzle constraints reject invalid state, status, attempts, leases, and duplicate source events',t=>{
  const {db}=fixture(t);insertObservation(db);for(const options of [{status:'running'},{state:'failed'},{attempts:-1},{state:'delivering'},{token:'unexpected-token'},{until:clock()}])assert.throws(()=>insertOutbox(db,options),/CHECK constraint failed/);
  insertOutbox(db);assert.throws(()=>insertOutbox(db,{id:'different-event'}),/UNIQUE constraint failed/);
});
test('Drizzle triggers prohibit event mutation/deletion but allow safe delivery bookkeeping',t=>{
  const {db}=fixture(t);insertObservation(db);insertOutbox(db);assert.throws(()=>db.exec("UPDATE board_observation_outbox SET status='completed'"),/event_immutable/);assert.throws(()=>db.exec('DELETE FROM board_observation_outbox'),/append_only/);
  db.prepare("UPDATE board_observation_outbox SET state='delivering',attempts=1,lease_token='test-lease',lease_until=?").run(clock());db.prepare("UPDATE board_observation_outbox SET state='delivered',delivered_at=?,lease_token=NULL,lease_until=NULL").run(clock());assert.equal(db.prepare('SELECT state FROM board_observation_outbox').get().state,'delivered');
});
test('actual observation and relay APIs commit, claim, and ACK against full production Drizzle chain',async t=>{
  const {db,binding}=fixture(t),outbox=createD1BoardObservationOutbox(binding,{clock}),store=createD1BoardObservationStore(binding,{clock,observationOutbox:outbox}),service=createBoardObservationService({store,clock});
  const source={threadId:'private-thread',environment:null,turnId:'private-turn',itemId:'private-item',observedAt:'2026-10-08T06:00:00.000Z'},base={tasks:[{id:'task-a',project:'Synthetic project',state:'unknown',observedAt:'2026-10-08T01:00:00.000Z'}]},bindings=[{taskId:'task-a',threadId:source.threadId,environment:null,readAllowed:true}],registry=[{id:'project-a',name:'Synthetic project',executionState:'paused'}];
  assert.equal(await store.available(),true);await service.record('owner-a',{taskId:'task-a',eventId:'real-api-test',expectedVersion:0,source,changes:{state:'partial',observation:'Synthetic verified result'}},base,bindings,registry);
  const [{eventId}]=await outbox.due('owner-a'),job=await outbox.claim('owner-a',eventId);assert.deepEqual(job.event.data,{projectId:'project-a',taskId:'task-a',status:'paused'});assert.equal(await outbox.ack('owner-a',eventId,job.leaseToken),true);assert.equal((await outbox.get('owner-a',eventId)).state,'delivered');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
