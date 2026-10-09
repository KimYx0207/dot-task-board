import {createRequire,syncBuiltinESMExports} from 'node:module';
const require=createRequire(import.meta.url);
const denied=()=>{throw new Error('TEST_NETWORK_DISABLED');};
for(const [module,names] of [['node:net',['connect','createConnection']],['node:tls',['connect']],['node:https',['request','get']],['node:http',['request','get']],['node:dns',['lookup','resolve','resolve4','resolve6']]])for(const name of names)require(module)[name]=denied;
for(const name of ['lookup','resolve','resolve4','resolve6'])require('node:dns').promises[name]=denied;
globalThis.fetch=denied;syncBuiltinESMExports();
