import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSitesPrivateEntry,sitesEventAuthorized,sitesProjectEventScopeFor} from '../src/application/sites-entry.mjs';
import {createIntakeService} from '../src/application/intake-service.mjs';
import {readEnvironmentProjectRegistry} from '../src/adapters/project-registry.mjs';
import {applySitesVisibility} from '../src/adapters/sites-visibility.mjs';
import {createWorker} from '../worker.mjs';
import compiledWorker from '../dist/server/index.js';
import {PROJECT_REQUEST_CREATED} from '../src/domain/mcp-events.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const owner='synthetic-scope-owner',audience='https://scope.example.com',projectId='synthetic-scope-project';
const sample=JSON.parse(readFileSync(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
const project={id:projectId,name:sample.tasks[0].project,aliases:[]};
const compiled=new Function(readFileSync(new URL('../dist/sites/index.js',import.meta.url),'utf8').replace('export default ','const compiledDefault = ')+'\nreturn {createSitesPrivateEntry,sitesEventAuthorized,sitesProjectEventScopeFor,createIntakeService};')();
const variants=[['source',{createSitesPrivateEntry,sitesEventAuthorized,sitesProjectEventScopeFor,createIntakeService}],['compiled',compiled]];
const baseEnv=()=>({DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:owner,DOT_BOARD_AUDIENCE:audience,DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([project]),DOT_BOARD_SNAPSHOT:JSON.stringify(sample)});
const details=(action='subscribe',overrides={})=>({ownerId:owner,name:PROJECT_REQUEST_CREATED,action,arguments:{projectId},...overrides});
// Freeze pre-diagnostic semantics, including the intentionally unchanged
// empty-string discrepancy and the independent list/unsubscribe early returns.
function legacyAuthorized(d,env){
 if(env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||env.DOT_BOARD_INTAKE_MCP_ENABLED!=='true'||d.ownerId!==env.DOT_BOARD_OWNER_ID||d.name!==PROJECT_REQUEST_CREATED)return false;
 if(d.action==='unsubscribe')return true;
 const registry=readEnvironmentProjectRegistry(env);if(registry.status!=='configured')return false;
 if(d.action==='list')return true;
 let hidden;try{hidden=JSON.parse(env.DOT_BOARD_HIDDEN_PROJECT_IDS??'[]');}catch{return false;}
 if(!Array.isArray(hidden)||hidden.includes(d.arguments?.projectId))return false;
 const p=registry.records.find(row=>row.id===d.arguments?.projectId);
 return Boolean(p&&p.acceptNewRequests!==false&&(!p.executionState||p.executionState==='active'));
}
function setup(t,entry){
 const fixture=sqliteIntakeFixture();t.after(()=>fixture.close());const env={...baseEnv(),DB:fixture.binding};
 const before=fixture.db.prepare('SELECT total_changes() AS n').get().n;let networkCalls=0;
 const original=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('Unexpected network access in read-only diagnostics');};t.after(()=>{globalThis.fetch=original;});
 const call=async(path,{user=owner,origin=audience,body}={})=>{const response=await entry.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(body?{'content-type':'application/json',origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,body:await response.json()};};
 const rpc=(method,params={},options={})=>call('/mcp',{...options,body:{jsonrpc:'2.0',id:1,method,params}});
 const list=options=>rpc('tools/call',{name:'list_request_projects',arguments:{}},options);
 const unchanged=()=>{assert.equal(fixture.db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(networkCalls,0);};
 return {env,list,call,rpc,unchanged};
}
for(const [label,api] of variants){
 test(label+': safe reasons share subscribe/delivery project-scope decisions',()=>{
  const cases=[
   [{},'project_scope_allowed',true],
   [{DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,executionState:'active',acceptNewRequests:true}])},'project_scope_allowed',true],
   ...['paused','deferred','canceled'].map(state=>[{DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,executionState:state}])},'project_'+state,false]),
   ...[{}, {executionState:'paused'}].map(extra=>[{DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{...project,acceptNewRequests:false,...extra}])},'project_requests_closed',false]),
   [{DOT_BOARD_PROJECT_REGISTRY:'[]'},'project_not_found',false],
   ...[undefined,''].map(raw=>[{DOT_BOARD_PROJECT_REGISTRY:raw},'project_registry_absent',false]),
   ...['{',JSON.stringify([{...project,executionState:'unsupported'}])].map(raw=>[{DOT_BOARD_PROJECT_REGISTRY:raw},'project_registry_invalid',false]),
   [{DOT_BOARD_HIDDEN_PROJECT_IDS:JSON.stringify([projectId])},'project_hidden',false],
   [{DOT_BOARD_HIDDEN_PROJECT_IDS:''},'empty_hidden_configuration',false],
   ...['{','{}','null','false'].map(raw=>[{DOT_BOARD_HIDDEN_PROJECT_IDS:raw},'invalid_hidden_configuration',false]),
   ...['[]',null].map(raw=>[{DOT_BOARD_HIDDEN_PROJECT_IDS:raw},'project_scope_allowed',true])
  ];
  for(const [overrides,reason,allowed] of cases){const env={...baseEnv(),...overrides},before=JSON.stringify(env),scope=api.sitesProjectEventScopeFor({ownerId:owner,projectId},env);assert.deepEqual(scope,{allowed,reason});for(const action of ['subscribe','deliver'])assert.equal(api.sitesEventAuthorized(details(action),env),scope.allowed);assert.equal(JSON.stringify(env),before);}
 });
 test(label+': legacy allow/deny matrix and revocation order remain unchanged',()=>{
  const environments=[baseEnv(),...[
   {DOT_BOARD_INGRESS:'other'}, {DOT_BOARD_INTAKE_MCP_ENABLED:'false'}, {DOT_BOARD_OWNER_ID:'another-owner'},
   ...[undefined,'','{','{}','[]',JSON.stringify([{...project,acceptNewRequests:false}]),...['active','paused','deferred','canceled'].map(executionState=>JSON.stringify([{...project,executionState}]))].map(DOT_BOARD_PROJECT_REGISTRY=>({DOT_BOARD_PROJECT_REGISTRY})),
   ...[undefined,null,'','[','{}','null','[]',JSON.stringify([projectId]),JSON.stringify(['other-project']),JSON.stringify([null]),JSON.stringify(['invalid id']),JSON.stringify(Array(201).fill('other-project'))].map(DOT_BOARD_HIDDEN_PROJECT_IDS=>({DOT_BOARD_HIDDEN_PROJECT_IDS}))
  ].map(overrides=>({...baseEnv(),...overrides}))];
  for(const env of environments)for(const action of ['subscribe','deliver','list','unsubscribe'])for(const extra of [{},{ownerId:null},{ownerId:'foreign-owner'},{name:'different-event'},{arguments:{projectId:'removed-project'}},{arguments:undefined}])assert.equal(api.sitesEventAuthorized(details(action,extra),env),legacyAuthorized(details(action,extra),env));
 });
 test(label+': adapter never returns another owner scope or raw configuration',()=>{
  for(const ownerId of [undefined,null,'','foreign-owner'])assert.equal(api.sitesProjectEventScopeFor({ownerId,projectId},baseEnv()),null);
  for(const overrides of [{DOT_BOARD_INGRESS:'other'},{DOT_BOARD_INTAKE_MCP_ENABLED:'false'},{DOT_BOARD_OWNER_ID:undefined}])assert.equal(api.sitesProjectEventScopeFor({ownerId:owner,projectId},{...baseEnv(),...overrides}),null);
  const env={...baseEnv(),DOT_BOARD_HIDDEN_PROJECT_IDS:JSON.stringify(['hidden-synthetic-marker']),DOT_BOARD_EXTRA_SECRET:'synthetic-secret-marker'};
  assert.deepEqual(api.sitesProjectEventScopeFor({ownerId:owner,projectId},env),{allowed:true,reason:'project_scope_allowed'});
 });
 test(label+': owner list enriches only its existing visible set without writes',async t=>{
  const c=setup(t,api.createSitesPrivateEntry());
  const hidden={id:'hidden-synthetic-project',name:'Hidden synthetic project',acceptNewRequests:true},unobserved={id:'unobserved-synthetic-project',name:'Unobserved synthetic project'},firstRequest={id:'empty-visible-project',name:'Empty visible project',acceptNewRequests:true};
  c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([project,hidden,unobserved,firstRequest]);
  const snapshot=structuredClone(sample);snapshot.tasks.push({...snapshot.tasks[0],id:'hidden-synthetic-task',project:hidden.name});c.env.DOT_BOARD_SNAPSHOT=JSON.stringify(snapshot);c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=JSON.stringify([hidden.id]);
  const listed=await c.list();assert.equal(listed.status,200);assert.equal(listed.body.result.isError,false);const projects=listed.body.result.structuredContent.projects;
  assert.deepEqual(projects.map(p=>p.id).sort(),[projectId,firstRequest.id].sort());
  for(const p of projects){assert.deepEqual(Object.keys(p).sort(),['eventScope','id','name']);assert.deepEqual(p.eventScope,{allowed:true,reason:'project_scope_allowed'});}
  for(const marker of [hidden.id,hidden.name,unobserved.id,unobserved.name,owner,'DOT_BOARD_'])assert(!JSON.stringify(listed.body).includes(marker));
  for(const options of [{user:null},{user:'foreign-owner'},{origin:'https://other.example.com'}]){const denied=await c.list(options);assert.equal(denied.status,options.user===null?401:403);assert(!JSON.stringify(denied.body).includes('eventScope'));assert(!JSON.stringify(denied.body).includes(projectId));}
  c.env.DOT_BOARD_INTAKE_MCP_ENABLED='false';assert.equal((await c.list()).status,403);c.env.DOT_BOARD_INTAKE_MCP_ENABLED='true';
  c.env.DOT_BOARD_PROJECT_REGISTRY='[]';assert.deepEqual((await c.list()).body.result.structuredContent,{projects:[]});c.unchanged();
 });
 test(label+': disabled delivery and completed tasks are not project-scope gates',async t=>{
  const c=setup(t,api.createSitesPrivateEntry());const snapshot=structuredClone(sample);snapshot.tasks=snapshot.tasks.map(task=>({...task,state:'completed'}));c.env.DOT_BOARD_SNAPSHOT=JSON.stringify(snapshot);
  assert.equal((await c.list()).body.result.structuredContent.projects[0].eventScope.allowed,true);
  const config=await c.call('/api/config');assert.equal(config.body.eventDelivery.canSubscribe,false);assert.equal(config.body.eventDelivery.reason,'direct_events_disabled');
  for(const [control,reason] of [[{acceptNewRequests:false},'project_requests_closed'],...['paused','deferred','canceled'].map(executionState=>[{executionState},'project_'+executionState])]){c.env.DOT_BOARD_PROJECT_REGISTRY=JSON.stringify([{...project,...control}]);assert.deepEqual((await c.list()).body.result.structuredContent.projects[0].eventScope,{allowed:false,reason});}
  c.unchanged();
 });
 test(label+': callback and storage readiness remain separate from project scope',async t=>{
  const c=setup(t,api.createSitesPrivateEntry());c.env.DOT_BOARD_EVENTS_ENABLED='true';
  assert.deepEqual((await c.list()).body.result.structuredContent.projects[0].eventScope,{allowed:true,reason:'project_scope_allowed'});
  assert.equal((await c.call('/api/config')).body.eventDelivery.reason,'callback_policy_missing');
  delete c.env.DB;assert.equal((await c.list()).body.result.structuredContent.projects[0].eventScope.allowed,true);
  assert.equal((await c.call('/api/config')).body.eventDelivery.reason,'event_storage_unavailable');c.unchanged();
 });
 test(label+': empty hidden setting is diagnosed without changing entry validation',async t=>{
  const c=setup(t,api.createSitesPrivateEntry());c.env.DOT_BOARD_HIDDEN_PROJECT_IDS='';assert.equal(applySitesVisibility(c.env),c.env);
  assert.deepEqual((await c.list()).body.result.structuredContent.projects[0].eventScope,{allowed:false,reason:'empty_hidden_configuration'});
  assert.equal((await c.rpc('events/list')).status,200);assert.equal(api.sitesEventAuthorized(details('list'),c.env),true);assert.equal(api.sitesEventAuthorized(details('unsubscribe'),c.env),true);assert.equal(api.sitesEventAuthorized(details('subscribe'),c.env),false);
  for(const raw of ['[','{}','null',JSON.stringify(['invalid id']),JSON.stringify([null]),JSON.stringify(Array(201).fill('other-project'))]){c.env.DOT_BOARD_HIDDEN_PROJECT_IDS=raw;const rejected=await c.list();assert.equal(rejected.status,503);assert.deepEqual(rejected.body,{error:'invalid_visibility_configuration'});assert(!JSON.stringify(rejected.body).includes('eventScope'));}c.unchanged();
 });
 test(label+': service default calls and no-adapter output retain exact legacy shape',async()=>{
  const board={status:200,body:{projectSummaries:[{id:projectId,name:'Alias',canonicalName:project.name},{id:projectId,name:project.name},{id:null,name:'Unregistered'}]}},legacy={projects:[{id:projectId,name:project.name}]};
  const service=api.createIntakeService({store:null,readBoard:async()=>board,capabilities:{}});assert.deepEqual(await service.projects(),legacy);assert.deepEqual(await service.projects(owner),legacy);
  const calls=[],enriched=api.createIntakeService({store:null,readBoard:async()=>board,capabilities:{},projectEventScope:d=>{calls.push(d);return api.sitesProjectEventScopeFor(d,baseEnv());}});
  assert.deepEqual(await enriched.projects(),legacy);assert.equal(calls.length,0);assert.deepEqual(await enriched.projects(owner),{projects:[{...legacy.projects[0],eventScope:{allowed:true,reason:'project_scope_allowed'}}]});assert.deepEqual(calls,[{ownerId:owner,projectId}]);assert.deepEqual(await enriched.projects('foreign-owner'),legacy);
 });
}
for(const [label,worker] of [['source',createWorker({})],['compiled',compiledWorker]])test(label+': generic Worker list has no Sites diagnostic adapter',async t=>{const c=setup(t,worker);assert.deepEqual((await c.list()).body.result.structuredContent,{projects:[{id:projectId,name:project.name}]});c.unchanged();});
