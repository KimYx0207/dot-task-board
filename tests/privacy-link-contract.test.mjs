import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker.mjs';
import compiledWorker from '../dist/server/index.js';
import {readEnvironmentProjectRegistry} from '../src/adapters/project-registry.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const ids={project:'project-alpha.v2:01',task:'task_alpha.v2:01',parent:'agent-alpha.v2:01',child:'worker_beta-2'};
function setup(t,worker){
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());
 const source={schemaVersion:'dot-board.snapshot/2',importedAt:'2026-10-07T20:00:00Z',source:{mode:'synthetic',label:'Independent synthetic regression'},tasks:[{id:ids.task,title:'Synthetic normal task',project:'Independent Alpha',state:'paused'}],agents:[{id:ids.parent,name:'Synthetic parent',type:'agent',kind:'coordinator',parentAgentId:null,projectNames:['Independent Alpha'],taskIds:[ids.task]},{id:ids.child,name:'Synthetic child',type:'subagent',kind:'worker',parentAgentId:ids.parent,projectNames:['Independent Alpha'],taskIds:[ids.task]}]};
 const registry=[{id:ids.project,name:'Independent Alpha'}];
 const env={DB:fixture.binding,DOT_BOARD_INTAKE_ENABLED:'true',DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_INTAKE_READER_VERIFIED:'true',DOT_BOARD_INTAKE_WRITER_VERIFIED:'true'};
 async function call(path='/api/board',mcp=false){env.DOT_BOARD_SNAPSHOT=JSON.stringify(source);env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify(registry);const response=await worker.fetch(new Request('https://synthetic.example'+path,{method:mcp?'POST':'GET',headers:{'oai-authenticated-user-id':'synthetic-regression-owner',...(mcp?{'content-type':'application/json'}:{})},...(mcp?{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_board_snapshot',arguments:{}}})}:{})}),env);return {status:response.status,body:await response.json()};}
 return {source,registry,env,call,fixture};
}
for(const [name,worker] of [['source',createWorker({})],['compiled',compiledWorker]]){
 test(`${name}: normal stable IDs, parent-child links, project routes and task associations remain exact`,async t=>{
  const c=setup(t,worker),api=await c.call(),mcp=await c.call('/mcp',true);assert.equal(api.status,200);assert.equal(mcp.body.result.isError,false);
  for(const board of [api.body,mcp.body.result.structuredContent.snapshot]){
   assert.equal(board.tasks[0].id,ids.task);assert.equal(board.tasks[0].projectId,ids.project);assert.deepEqual(board.tasks[0].assignedAgentIds,[ids.parent,ids.child]);
   assert.deepEqual(board.agents.map(a=>a.id),[ids.parent,ids.child]);assert.equal(board.agents[1].parentAgentId,ids.parent);assert.equal(board.agents[1].relationshipState,'known');assert.deepEqual(board.agents[1].taskIds,[ids.task]);assert.equal(board.projectSummaries[0].id,ids.project);assert.deepEqual(board.projectSummaries[0].agentIds,[ids.parent,ids.child]);
  }
 });
 test(`${name}: unsafe registry ID rejects whole registry and disables intake without rewriting tasks or inventing routing identity`,async t=>{
  const c=setup(t,worker),original=structuredClone(c.source);c.registry[0].id='sk-SYNTHETIC_ONLY0123456789';const api=await c.call(),caps=await c.call('/api/intake/capabilities');
  assert.equal(readEnvironmentProjectRegistry(c.env).status,'invalid');assert.deepEqual(readEnvironmentProjectRegistry(c.env).records,[]);assert.equal(caps.body.registryStatus,'invalid');assert.equal(caps.body.canSubmit,false);assert.equal(caps.body.enabled,false);assert.equal(api.status,200);
  assert.equal(api.body.tasks[0].id,ids.task);assert.equal(api.body.tasks[0].title,original.tasks[0].title);assert.equal(api.body.tasks[0].project,'Independent Alpha');assert.equal(api.body.tasks[0].projectId,null);assert.equal(api.body.projectSummaries[0].id,null);assert.deepEqual(c.source,original);
 });
 test(`${name}: unsafe Agent ID fails whole projection, never silently renames or drops required identity`,async t=>{
  const c=setup(t,worker);c.source.agents[1].id='sk-SYNTHETIC_AGENT0123456789';const original=JSON.stringify(c.source),api=await c.call(),mcp=await c.call('/mcp',true);
  assert.equal(api.status,503);assert.deepEqual(api.body,{error:'invalid_agent_identity'});assert.equal(mcp.body.result.isError,true);assert.equal(mcp.body.result.structuredContent.error,'board_unavailable');assert.equal(mcp.body.result.structuredContent.snapshot,undefined);assert.equal(JSON.stringify(c.source),original);
 });
 test(`${name}: plain and encoded auth fragments rejected in task and Agent links; safe anchors preserved`,async t=>{
  const c=setup(t,worker),unsafe=['https://example.com/r#access_token=SYNTHETIC_FRAGMENT_SECRET','https://example.com/r#%61ccess_token%3DSYNTHETIC_ENCODED','https://example.com/r#/callback?authorization=SYNTHETIC_AUTH','https://example.com/r#state=ok&token=SYNTHETIC_TOKEN','https://example.com/r#Bearer%20SYNTHETIC0123456789'];
  const safe='https://example.com/report#section-2';const links=[...unsafe.map(url=>({label:'Synthetic unsafe',url})),{label:'Synthetic safe',url:safe}];c.source.tasks[0].evidence=links;c.source.agents[1].latestResult={summary:'Synthetic verified result',evidence:links};
  const api=await c.call(),mcp=await c.call('/mcp',true);for(const board of [api.body,mcp.body.result.structuredContent.snapshot]){assert.deepEqual(board.tasks[0].evidence,[{label:'Synthetic safe',url:safe}]);assert.deepEqual(board.agents[1].latestResult.evidence,[{label:'Synthetic safe',url:safe}]);assert.equal(board.agents[1].parentAgentId,ids.parent);}
 });
 test(`${name}: recognized credential in a benign query parameter must not reflect`,async t=>{
  const c=setup(t,worker),marker='sk-SYNTHETIC_QUERY0123456789';c.source.tasks[0].evidence=[{label:'Synthetic secret under benign query key',url:'https://example.com/report?result='+marker}];const api=await c.call(),mcp=await c.call('/mcp',true);assert(!JSON.stringify(api.body).includes(marker),'Known credential pattern reflected from result query value');assert(!JSON.stringify(mcp.body).includes(marker),'Known credential pattern reflected from MCP result query value');
 });
}
