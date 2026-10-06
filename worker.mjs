import {handleRequest} from './src/presentation/http.mjs';
import {readEnvironmentSnapshot} from './src/adapters/snapshot.mjs';
import {boardConfig} from './config/board.mjs';
export function createWorker(assets) {
  return {fetch(request,env) {
    return handleRequest(request,{
      readSnapshot:()=>readEnvironmentSnapshot(env),
      getAsset:path=>assets[path],config:boardConfig
    });
  }};
}
