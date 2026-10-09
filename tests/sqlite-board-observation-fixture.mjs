import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
export function sqliteBoardObservationFixture(filename=':memory:'){
  const db=new DatabaseSync(filename);db.exec('PRAGMA busy_timeout=10000');db.exec('PRAGMA foreign_keys=ON');
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='board_observation_events'").get();
  if(!exists)db.exec(readFileSync(new URL('../migrations/0005_board_observations.sql',import.meta.url),'utf8'));
  const outboxExists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='board_observation_outbox'").get();
  if(!outboxExists)db.exec(readFileSync(new URL('../migrations/0006_board_observation_outbox.sql',import.meta.url),'utf8'));
  function prepared(sql,params=[]){
    if(sql.includes(';'))throw Error('One statement per prepare');
    const execute=()=>{const statement=db.prepare(sql);if(/^\s*SELECT\b/i.test(sql))return {results:statement.all(...params),meta:{changes:0}};const result=statement.run(...params);return {results:[],meta:{changes:Number(result.changes)}};};
    return {bind:(...values)=>prepared(sql,values),all:async()=>execute(),first:async()=>execute().results[0]??null,run:async()=>execute(),execute};
  }
  const binding={prepare:prepared,batch:async statements=>{db.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,binding,close:()=>db.close()};
}
