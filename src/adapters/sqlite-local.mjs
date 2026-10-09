import {DatabaseSync,backup} from 'node:sqlite';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export async function openLocalStore(filename,{migrations=new URL('../../migrations/',import.meta.url)}={}) {
 if(filename!==':memory:')await mkdir(dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000');
 try{
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
  if(tables.length&&!tables.includes('local_migrations'))throw Error('Existing database has no migration ledger; use a new local data directory');
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
  const files=(await readdir(migrations)).filter(x=>/^\d+_[a-z_]+\.sql$/.test(x)).sort();
  const applied=db.prepare('SELECT name FROM local_migrations').all();
  if(applied.some(row=>!files.includes(row.name)))throw Error('Database schema is newer than this release; rollback requires an explicitly reviewed compatible backup');
  for(const name of files){
   const sql=await readFile(new URL(name,migrations),'utf8'),sha256=createHash('sha256').update(sql).digest('hex');
   const prior=db.prepare('SELECT sha256 FROM local_migrations WHERE name=?').get(name);
   if(prior){if(prior.sha256!==sha256)throw Error('Previously applied migration was modified');continue;}
   if(filename!==':memory:'&&db.prepare('SELECT COUNT(*) AS n FROM local_migrations').get().n)await backup(db,filename+'.before-'+name+'-'+randomUUID()+'.sqlite');
   db.exec('BEGIN IMMEDIATE');try{for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(statement);db.prepare('INSERT INTO local_migrations VALUES (?,?,?)').run(name,sha256,new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function prepare(sql,values=[]){
   if(sql.includes(';'))throw Error('Only one parameterized statement is allowed');
   const execute=()=>{const statement=db.prepare(sql);if(/^\s*SELECT\b/i.test(sql))return {results:statement.all(...values),meta:{changes:0}};const result=statement.run(...values);return {results:[],meta:{changes:Number(result.changes)}};};
   return {bind:(...args)=>prepare(sql,args),all:async()=>execute(),first:async()=>execute().results[0]??null,run:async()=>execute(),execute};
  }
  const binding={prepare,batch:async statements=>{db.exec('BEGIN IMMEDIATE');try{const result=statements.map(x=>x.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {binding,close:()=>db.close()};
 }catch(error){db.close();throw error;}
}
