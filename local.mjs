import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {noSymlinkPath} from './src/adapters/local-paths.mjs';
import {createLocalBoardServer,requireExternalDataPath} from './src/adapters/node-local.mjs';
const demo=process.argv.includes('--demo');
const snapshotFile=demo?new URL('./examples/synthetic-snapshot.json',import.meta.url):requireExternalDataPath(process.env.DOT_BOARD_SNAPSHOT_PATH??'');
const snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
if(demo){if(snapshot.source?.mode!=='synthetic')throw Error('Demo requires explicitly synthetic input');const now=new Date().toISOString();snapshot.importedAt=now;for(const t of snapshot.tasks)if(t.observedAt)t.observedAt=now;for(const a of snapshot.agents??[]){if(a.activity?.observedAt)a.activity.observedAt=now;if(a.source?.observedAt)a.source.observedAt=now;}}
const registry=process.env.DOT_BOARD_PROJECT_REGISTRY?JSON.parse(process.env.DOT_BOARD_PROJECT_REGISTRY):snapshot.projectRegistry??(demo?[...new Set(snapshot.tasks.map(t=>t.project))].map(name=>({id:'demo-'+createHash('sha256').update(name).digest('hex').slice(0,12),name,aliases:[]})):null);
if(!registry?.length)throw Error('Provide DOT_BOARD_PROJECT_REGISTRY or snapshot.projectRegistry');
const directory=process.env.DOT_BOARD_DATA_DIR?requireExternalDataPath(process.env.DOT_BOARD_DATA_DIR):demo?await mkdtemp(join(tmpdir(),'dot-board-demo-')):null;
if(!directory)throw Error('Set DOT_BOARD_DATA_DIR outside the source checkout');
const port=Number(process.env.DOT_BOARD_PORT||4317);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const server=await createLocalBoardServer({snapshot,registry,dbPath:noSymlinkPath(directory,join(directory,'requests.sqlite')),queue:demo||process.env.DOT_BOARD_QUEUE_ENABLED==='true',capacity:Number(process.env.DOT_BOARD_QUEUE_CAPACITY||1),instanceId:process.env.DOT_BOARD_INSTANCE_ID||'local-direct',releaseId:process.env.DOT_BOARD_RELEASE_ID||'unmanaged',readSnapshot:demo?null:async()=>JSON.parse(await readFile(requireExternalDataPath(snapshotFile),'utf8'))});
server.listen(port,'127.0.0.1',()=>{console.log(`${demo?'Synthetic interactive demo':'Local single-user board'}: http://127.0.0.1:${port}`);console.log('Requests persist locally. Native task execution and external Events are not connected.');});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
