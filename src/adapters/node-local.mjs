import {createServer} from 'node:http';
import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {createWorker} from '../../worker.mjs';
import {boardConfig} from '../../config/board.mjs';
import {canonicalPath,pathInside} from './local-paths.mjs';
import {openLocalStore} from './sqlite-local.mjs';
const root=canonicalPath(fileURLToPath(new URL('../../',import.meta.url)));
export function requireExternalDataPath(filename){const path=canonicalPath(filename);if(pathInside(root,path))throw Error('Keep runtime data outside the source checkout');return path;}
export async function createLocalBoardServer({snapshot,registry,dbPath,queue=false,capacity=1,instanceId='local-demo',releaseId='unmanaged',readSnapshot=null}={}){
 if(!snapshot||!Array.isArray(registry)||!registry.length)throw Error('A snapshot and explicit project registry are required');
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>32)throw Error('Invalid queue capacity');
 if(dbPath!==':memory:'){try{if((await lstat(dbPath)).isSymbolicLink())throw Error('Database path must not be a symlink');}catch(error){if(error.code!=='ENOENT')throw error;}}
 const local=await openLocalStore(dbPath===':memory:'?dbPath:requireExternalDataPath(dbPath));
 const assets={};for(const name of ['index.html','app.js','styles.css','collaboration-graph.js','collaboration-graph.css','project-overview.js','project-overview.css','dot-agent-roles.png','queue-controls.js','queue-controls.css','project-clarity.js','task-display.js','project-clarity.css','board-brand.css','brand-links.js','board-team.png'])assets['/'+name]=await readFile(new URL('../../public/'+name,import.meta.url));
 const worker=createWorker(assets,boardConfig),environment={DB:local.binding,DOT_BOARD_SNAPSHOT:JSON.stringify(snapshot),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify(registry),DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_INTAKE_READER_VERIFIED:'false',DOT_BOARD_INTAKE_WRITER_VERIFIED:'false',DOT_BOARD_QUEUE_ENABLED:queue?'true':'false',DOT_BOARD_QUEUE_CAPACITY:String(capacity)};
 const server=createServer(async(req,res)=>{try{
  if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host??'')||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Local access only');return;}
  const origin='http://'+req.headers.host,headers=new Headers(req.headers);headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');headers.delete('authorization');headers.set('oai-authenticated-user-id','local-owner');
  if(headers.has('origin')&&headers.get('origin')!==origin){res.writeHead(403);res.end('Origin rejected');return;}
  const options={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
  const requestEnvironment=typeof readSnapshot==='function'&&(req.url.startsWith('/api/')||req.url==='/mcp')?{...environment,DOT_BOARD_SNAPSHOT:JSON.stringify(await readSnapshot())}:environment;
  let response=await worker.fetch(new Request(origin+req.url,options),requestEnvironment);
  if(req.url==='/api/intake/capabilities'&&req.method==='GET'){const capability=await response.json();response=Response.json({...capability,bridge:'local_mcp'},{headers:{'cache-control':'no-store'}});}
  if(req.url==='/health'&&req.method==='GET'){const status=await response.json();response=Response.json({...status,mode:'local-single-user',instanceId,pid:process.pid,releaseId,version:'0.2.0-rc.1',eventsEnabled:false,nativeExecutionConnected:false},{headers:{'cache-control':'no-store'}});}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500,{'content-type':'text/plain','cache-control':'no-store'});res.end('Local board unavailable');}});
 server.once('close',()=>local.close());return server;
}
