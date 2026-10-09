import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,stat,readdir,mkdir,rename,rm,copyFile,open} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalPath,pathInside,noSymlinkPath} from '../src/adapters/local-paths.mjs';
import {spawn,spawnSync} from 'node:child_process';
const source=canonicalPath(fileURLToPath(new URL('../',import.meta.url)));
const [action,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){const key=args[i];if(!['--dir','--port','--snapshot','--registry','--demo','--queue'].includes(key))throw Error('Unknown option');if(['--demo','--queue'].includes(key)){options[key]=true;continue;}if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing option value');options[key]=args[++i];}
if(!['install','start','status','stop','rollback'].includes(action)||!options['--dir'])throw Error('Usage: node scripts/manage.mjs install|start|status|stop|rollback --dir ABSOLUTE_PATH [--demo | --snapshot FILE --registry FILE] [--port 4317] [--queue]');
if(options['--demo']&&(options['--snapshot']||options['--registry']))throw Error('Choose either synthetic demo or real snapshot inputs');
if(Number(process.versions.node.split('.')[0])<24)throw Error('Node 24 or newer is required');
const home=canonicalPath(options['--dir']);
const inside=(root,path)=>{const rel=relative(root,path);return rel===''||rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
if(inside(source,home)||inside(home,source))throw Error('Installation directory and source checkout must be separate');
const safe=path=>noSymlinkPath(home,path);
const configPath=join(home,'installation.json'),runPath=join(home,'process.json');
async function readJson(path){noSymlinkPath(home,path);try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomicJson(path,value){noSymlinkPath(home,path);const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,path);}
const hash=value=>typeof value==='string'&&/^[a-f0-9]{20}$/.test(value);
const portValid=value=>Number.isInteger(value)&&value>0&&value<=65535;
function fields(value,allowed){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));}
function validateRun(value){if(value===null)return null;if(!fields(value,['pid','port','instanceId','releaseId'])||!Number.isInteger(value.pid)||value.pid<=1||value.pid>2147483647||!portValid(value.port)||!hash(value.releaseId)||typeof value.instanceId!=='string'||!/^[-a-f0-9]{36}$/.test(value.instanceId))throw Error('Invalid process record; no signal or process operation is allowed');return value;}
function validateConfig(value){if(value===null)return null;if(!fields(value,['schemaVersion','mode','port','snapshot','registry','queue','releaseId','previousReleaseId'])||value.schemaVersion!==1||!['demo','snapshot'].includes(value.mode)||!portValid(value.port)||typeof value.queue!=='boolean'||!hash(value.releaseId)||value.previousReleaseId!==null&&!hash(value.previousReleaseId))throw Error('Invalid installation configuration');if(value.mode==='snapshot'){for(const path of [value.snapshot,value.registry])if(typeof path!=='string'||!isAbsolute(path)||inside(source,canonicalPath(path))||inside(join(home,'releases'),canonicalPath(path)))throw Error('Invalid external data path');}else if(value.snapshot!==null||value.registry!==null)throw Error('Invalid demo configuration');return value;}

async function collectFiles(root){
 const skip=new Set(['.git','node_modules','dist','coverage']),files=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(dir===root&&skip.has(entry.name))continue;const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Release contains a symlink');if(entry.isDirectory())await walk(path);else if(entry.isFile()){const body=await readFile(path);files.push({path:relative(root,path),body,sha256:createHash('sha256').update(body).digest('hex')});}else throw Error('Release contains a non-regular file');}}
 await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path));return files;
}
function digestFiles(files){return createHash('sha256').update(JSON.stringify(files.map(({path,sha256})=>({path,sha256})))).digest('hex').slice(0,20);}
async function verifyRelease(id){if(!hash(id))throw Error('Invalid release identity');const root=safe(join(home,'releases',id));const files=await collectFiles(root);if(digestFiles(files)!==id||!files.some(f=>f.path==='local.mjs'))throw Error('Installed release content does not match its verified identity');return {root,files};}
async function compatibleDatabase(files){
 const filename=safe(join(home,'data','requests.sqlite'));try{await stat(filename);}catch(error){if(error.code==='ENOENT')return;throw error;}
 const db=new DatabaseSync(filename,{readOnly:true});try{const ledger=db.prepare('SELECT name,sha256 FROM local_migrations').all();for(const row of ledger){const sql=files.find(f=>f.path===join('migrations',row.name));if(!sql||sql.sha256!==row.sha256)throw Error('Rollback code is incompatible with the current database; review a compatible backup before proceeding');}}finally{db.close();}
}

async function health(){const run=validateRun(await readJson(runPath));if(!run)return {running:false};let alive;try{process.kill(run.pid,0);alive=true;}catch{alive=false;}if(!alive)return {running:false,stale:true};try{const response=await fetch(`http://127.0.0.1:${run.port}/health`,{signal:AbortSignal.timeout(1000)});const body=await response.json();if(response.ok&&body.instanceId===run.instanceId&&body.pid===run.pid&&body.releaseId===run.releaseId)return {running:true,pid:run.pid,port:run.port,url:`http://127.0.0.1:${run.port}`,releaseId:run.releaseId,health:body};}catch{}return {running:false,unverifiedProcess:true};}
if(action==='status'){console.log(JSON.stringify(await health()));process.exit(0);}
await mkdir(home,{recursive:true,mode:0o700});const lock=safe(join(home,'.operation-lock'));try{await mkdir(lock);}catch{throw Error('Another installation operation is active; do not remove its lock while it is running');}
try{
 const active=await health();
 if(action==='stop'){
  if(active.unverifiedProcess)throw Error('Process identity is unverified; refusing to stop it');
  if(active.running){process.kill(active.pid,'SIGTERM');for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));try{process.kill(active.pid,0);}catch{break;}if(i===59)throw Error('Graceful shutdown is still pending');}}
  await rm(runPath,{force:true});console.log(JSON.stringify({stopped:true}));
 }else if(action==='start'){
  if(active.running){console.log(JSON.stringify({...active,reused:true}));}
  else{
   if(active.unverifiedProcess)throw Error('An existing process is not verified; resolve it before starting another');
   const config=validateConfig(await readJson(configPath));if(!config)throw Error('Install first');await verifyRelease(config.releaseId);
   const instanceId=randomUUID(),runtime=safe(join(home,'data'));await mkdir(runtime,{recursive:true,mode:0o700});safe(join(runtime,'requests.sqlite'));
   const env={...process.env,DOT_BOARD_DATA_DIR:runtime,DOT_BOARD_PORT:String(config.port),DOT_BOARD_INSTANCE_ID:instanceId,DOT_BOARD_RELEASE_ID:config.releaseId,DOT_BOARD_QUEUE_ENABLED:config.queue?'true':'false',DOT_BOARD_QUEUE_CAPACITY:'1'};
   delete env.DOT_BOARD_SNAPSHOT;delete env.DOT_BOARD_SNAPSHOT_PARTS;delete env.DOT_BOARD_TASK_STATUS_OVERLAY;delete env.DOT_BOARD_EVENTS_ENABLED;
   if(config.mode==='snapshot'){env.DOT_BOARD_SNAPSHOT_PATH=config.snapshot;env.DOT_BOARD_PROJECT_REGISTRY=await readFile(config.registry,'utf8');}else{delete env.DOT_BOARD_SNAPSHOT_PATH;delete env.DOT_BOARD_PROJECT_REGISTRY;}
   const output=await open(safe(join(home,'server.log')),'a',0o600);const child=spawn(process.execPath,[safe(join(home,'releases',config.releaseId,'local.mjs')),...(config.mode==='demo'?['--demo']:[])],{cwd:join(home,'releases',config.releaseId),env,detached:true,stdio:['ignore',output.fd,output.fd]});await output.close();child.unref();
   await atomicJson(runPath,{pid:child.pid,port:config.port,instanceId,releaseId:config.releaseId});
   let result;for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));result=await health();if(result.running)break;}
   if(!result?.running)throw Error('Startup is not verified; inspect server.log before retrying');
   console.log(JSON.stringify({...result,reused:false}));
  }
 }else{
  if(active.running||active.unverifiedProcess)throw Error('Stop the verified local app before changing its installed version');
  const previous=validateConfig(await readJson(configPath));
  if(previous&&action==='install'){if(options['--demo']&&previous.mode!=='demo'||options['--snapshot']&&canonicalPath(options['--snapshot'])!==previous.snapshot||options['--registry']&&canonicalPath(options['--registry'])!==previous.registry)throw Error('Existing installation inputs are preserved; use a separate install directory for a different data source');}
  if(action==='rollback'){
   if(!previous?.previousReleaseId)throw Error('No earlier release is retained');const targetRelease=await verifyRelease(previous.previousReleaseId);await compatibleDatabase(targetRelease.files);
   // Data is never silently restored or downgraded. A migration compatibility check runs at startup.
   const next={...previous,releaseId:previous.previousReleaseId,previousReleaseId:previous.releaseId};await atomicJson(configPath,next);console.log(JSON.stringify({rolledBack:true,releaseId:next.releaseId,dataPreserved:true}));
  }else{
   const checked=spawnSync(process.execPath,[join(source,'scripts/check-public.mjs'),source],{encoding:'utf8'});if(checked.status!==0)throw Error('Source publication boundary check failed: '+checked.stderr);
   const files=await collectFiles(source),releaseId=digestFiles(files);
   const target=safe(join(home,'releases',releaseId));let existing=false;try{await readdir(target);existing=true;}catch{}
   if(existing){for(const f of files)if(createHash('sha256').update(await readFile(safe(join(target,f.path)))).digest('hex')!==f.sha256)throw Error('Existing release was modified; refusing to overwrite');}
   else{const staging=target+'.'+randomUUID()+'.tmp';await mkdir(staging,{recursive:true,mode:0o700});for(const f of files){await mkdir(join(staging,f.path,'..'),{recursive:true});await writeFile(join(staging,f.path),f.body);}await rename(staging,target);}
   const mode=previous?.mode??(options['--demo']?'demo':'snapshot'),port=Number(options['--port']??previous?.port??4317);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
   const snapshot=previous?.snapshot??(options['--snapshot']?canonicalPath(options['--snapshot']):null),registry=previous?.registry??(options['--registry']?canonicalPath(options['--registry']):null);
   if(mode==='snapshot'&&(!snapshot||!registry))throw Error('For real data, provide external --snapshot and --registry files; or explicitly choose --demo');
   for(const path of [snapshot,registry].filter(Boolean)){if(inside(source,path)||inside(join(home,'releases'),path))throw Error('User data must stay outside source/releases');JSON.parse(await readFile(path,'utf8'));}
   const config={schemaVersion:1,mode,port,snapshot,registry,queue:previous?.queue??Boolean(options['--queue']),releaseId,previousReleaseId:previous?.releaseId===releaseId?previous.previousReleaseId:previous?.releaseId??null};
   validateConfig(config);await atomicJson(configPath,config);console.log(JSON.stringify({installed:true,reused:existing,releaseId,mode,port,dataPreserved:true}));
  }
 }
}finally{await rm(lock,{recursive:true,force:true});}
