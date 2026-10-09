import {readEnvironmentProjectRegistry,withIndependentProjectRegistry,gateIntakeByProjectRegistry} from './src/adapters/project-registry.mjs';
import {intakeCapabilities} from './src/domain/intake.mjs';
import {createIntakeService} from './src/application/intake-service.mjs';
import {readBoard} from './src/application/board-service.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {handleRequest} from './src/presentation/http.mjs';
import {parseSnapshot,readEnvironmentSnapshot} from './src/adapters/snapshot.mjs';
import {boardConfig} from './config/board.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export function createBoardServer({env=process.env,intakeStore=null,authenticateIntakeRequest=null}={}) {
  const registry=readEnvironmentProjectRegistry(env);
  async function readSnapshot() {
    if (!env.DOT_BOARD_SNAPSHOT_PATH) return withIndependentProjectRegistry(readEnvironmentSnapshot(env),registry);
    const filename=resolve(env.DOT_BOARD_SNAPSHOT_PATH);
    const rel=relative(root,filename);
    if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('Real runtime snapshot must be outside the source checkout');
    return withIndependentProjectRegistry(parseSnapshot(await readFile(filename,'utf8')),registry);
  }
  return createServer(async(req,res)=>{
    try {
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host ?? '')) {
        res.writeHead(403,{'content-type':'text/plain','cache-control':'no-store'});res.end('Loopback host only');return;
      }
      const origin=`http://${req.headers.host}`;
      const requestHeaders=new Headers(req.headers);requestHeaders.delete('oai-authenticated-user-id');requestHeaders.delete('oai-authenticated-user-email');
      if(authenticateIntakeRequest){const verified=await authenticateIntakeRequest(req);if(verified)requestHeaders.set('oai-authenticated-user-id',verified);}
      const options={method:req.method,headers:requestHeaders};
      if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
      const request=new Request(`${origin}${req.url}`,options);
      const capabilities=gateIntakeByProjectRegistry(intakeCapabilities(env,Boolean(intakeStore)),registry);
      const service=createIntakeService({store:intakeStore,readBoard:()=>readBoard(readSnapshot,boardConfig),capabilities});
      const response=await handleRequest(request,{readSnapshot,config:boardConfig,intake:{service,capabilities,hostEnabled:false},getAsset:path=>readFile(new URL(`./public${path}`,import.meta.url))});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(500,{'content-type':'text/plain','cache-control':'no-store'});res.end('Unable to read board');}
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port=Number(process.env.DOT_BOARD_PORT || 4317);
  if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid port');
  createBoardServer().listen(port,'127.0.0.1',()=>console.log(`dot board: http://127.0.0.1:${port}`));
}
