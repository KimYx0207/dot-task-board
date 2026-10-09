import test from 'node:test';
import assert from 'node:assert/strict';
import {handleManualStatusRequest} from '../src/presentation/manual-status-http.mjs';
const url='https://example.com/api/tasks/test.primary/status';
const owner={'oai-authenticated-user-id':'owner'};
test('manual status HTTP reads and writes path-bound task behind owner and same origin',async()=>{
 const calls=[],manualStatus={get:async(o,t)=>({taskId:t,version:0,state:null}),set:async(o,i)=>{calls.push([o,i]);return {...i,version:1,duplicate:false};}};
 assert.equal(await handleManualStatusRequest(new Request('https://example.com/other'),{manualStatus}),null);
 assert.equal((await handleManualStatusRequest(new Request(url),{manualStatus})).status,401);
 const read=await handleManualStatusRequest(new Request(url,{headers:owner}),{manualStatus});assert.equal((await read.json()).state,null);
 const input={expectedVersion:0,eventId:'synthetic-1',state:'running'};
 const post=(headers,body=input)=>handleManualStatusRequest(new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}),{manualStatus});
 assert.equal((await post(owner)).status,403);assert.equal(calls.length,0);
 assert.equal((await post({...owner,origin:'https://example.com'},{...input,taskId:'other'})).status,400);assert.equal(calls.length,0);
 assert.equal((await post({...owner,origin:'https://example.com'})).status,200);
 assert.deepEqual(calls,[['owner',{...input,taskId:'test.primary'}]]);
});
test('manual status HTTP preserves conflict and fails closed without storage service',async()=>{
 const request=new Request(url,{headers:owner});assert.equal((await handleManualStatusRequest(request,{})).status,503);
 const manualStatus={get:async()=>{throw Object.assign(new Error(),{code:'version_conflict',status:409});}};
 const response=await handleManualStatusRequest(request,{manualStatus});assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'version_conflict'});
});
