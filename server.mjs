import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {handleRequest} from './src/presentation/http.mjs';
import {parseSnapshot,readEnvironmentSnapshot} from './src/adapters/snapshot.mjs';
import {boardConfig} from './config/board.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export function createBoardServer({env=process.env}={}) {
  async function readSnapshot() {
    if (!env.DOT_BOARD_SNAPSHOT_PATH) return readEnvironmentSnapshot(env);
    const filename=resolve(env.DOT_BOARD_SNAPSHOT_PATH);
    const rel=relative(root,filename);
    if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('Real runtime snapshot must be outside the source checkout');
    return parseSnapshot(await readFile(filename,'utf8'));
  }
  return createServer(async(req,res)=>{
    try {
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host ?? '')) {
        res.writeHead(403,{'content-type':'text/plain','cache-control':'no-store'});res.end('Loopback host only');return;
      }
      const request=new Request(`http://127.0.0.1${req.url}`,{method:req.method});
      const response=await handleRequest(request,{readSnapshot,config:boardConfig,getAsset:path=>readFile(new URL(`./public${path}`,import.meta.url),'utf8')});
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
