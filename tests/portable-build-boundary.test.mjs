import test from 'node:test';import assert from 'node:assert/strict';
import publicWorker from '../dist/server/index.js';import privateWorker from '../dist/sites/index.js';
import {createManualStatusController} from '../public/project-clarity.js';
const env={DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:'synthetic-owner',DOT_BOARD_AUDIENCE:'https://example.com'};
test('public and Sites builds retain separate access boundaries',async()=>{
 assert.equal((await publicWorker.fetch(new Request('https://example.com/'))).status,200);
 for(const path of ['/','/board-team.png','/board-brand.css','/brand-links.js','/api/config']){
  assert.equal((await privateWorker.fetch(new Request('https://example.com'+path),env)).status,401,path);
  assert.equal((await privateWorker.fetch(new Request('https://example.com'+path,{headers:{'oai-authenticated-user-id':'synthetic-other'}}),env)).status,403,path);
 }
 const publicConfig=await(await publicWorker.fetch(new Request('https://example.com/api/config'))).json();assert.equal(publicConfig.manualStatusEnabled,false);
 const privateConfig=await(await privateWorker.fetch(new Request('https://example.com/api/config',{headers:{'oai-authenticated-user-id':'synthetic-owner'}}),env)).json();assert.equal(privateConfig.manualStatusEnabled,true);
});
test('unsupported manual status never sends a write or claims a save',async()=>{
 let calls=0;const controller=createManualStatusController({supported:()=>false,requestJson:async()=>{calls++;throw Error('unexpected');}}),task={id:'synthetic-task',state:'queued'};
 await controller.quickSave(task,'completed');await controller.save(task);assert.equal(calls,0);assert.equal(controller.get(task.id).message,'');assert.equal(controller.get(task.id).loaded,false);assert.match(controller.get(task.id).error,/未接通/);
});
