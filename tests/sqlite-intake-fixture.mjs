import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
export function sqliteIntakeFixture(filename=':memory:') {
  const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intake_requests'").get();
  if(!exists){for(const filename of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){const sql=readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(statement);}}
  function prepared(sql,params=[]){
    if(sql.includes(';'))throw Error('One statement per prepare');
    const execute=()=>{const statement=db.prepare(sql);if(/^\s*SELECT\b/i.test(sql))return {results:statement.all(...params),meta:{changes:0}};const result=statement.run(...params);return {results:[],meta:{changes:Number(result.changes)}};};
    return {bind:(...values)=>prepared(sql,values),all:async()=>execute(),first:async()=>execute().results[0]??null,run:async()=>execute(),execute};
  }
  const binding={prepare:prepared,batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,binding,close:()=>db.close()};
}
