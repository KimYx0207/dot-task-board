import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createWorker} from '../worker.mjs';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
const sample=JSON.parse(await readFile(new URL('../fixtures/synthetic.json',import.meta.url),'utf8'));
test('integrated graph keeps private intake and partial-update UI wiring',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const marker of ['id="request-workspace"','id="request-body"','id="request-submit"','id="collaboration-map"','id="inspector"'])assert(html.includes(marker));
  assert(html.includes('<script src="/app.js" type="module">'));
  assert(app.includes('renderInspector();renderCollaboration();renderIntake();'));
  assert(app.includes('项任务局部更新'));assert(app.includes('未更新任务及 Agent 记录仍沿用原时间'));
});
test('built graph assets are reachable through existing private HTTP surface without queue writes',async t=>{
  const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const worker=(await import('../dist/server/index.js?graph-integration='+Date.now())).default;
  const db=sqliteIntakeFixture();t.after(()=>db.close());
  const env={DB:db.binding,DOT_BOARD_SNAPSHOT:JSON.stringify(sample),DOT_BOARD_PROJECT_REGISTRY:JSON.stringify([{id:'synthetic-project',name:sample.tasks[0].project,aliases:[]}]),DOT_BOARD_INTAKE_MCP_ENABLED:'true',DOT_BOARD_INTAKE_CONNECTION_VERIFIED:'true',DOT_BOARD_INTAKE_ENABLED:'true'};
  for(const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/collaboration-graph.js','text/javascript'],['/collaboration-graph.css','text/css']]){
    const r=await worker.fetch(new Request('https://example.com'+path),env);assert.equal(r.status,200,path);assert(r.headers.get('content-type').startsWith(type));assert((await r.text()).length>0);
  }
  assert.equal((await worker.fetch(new Request('https://example.com/collaboration-graph.js',{method:'POST'}),env)).status,405);
  const board=await(await worker.fetch(new Request('https://example.com/api/board'),env)).json();assert.equal(board.tasks.length,sample.tasks.length);assert.equal(board.importedAt,sample.importedAt);
  const capabilities=await(await worker.fetch(new Request('https://example.com/api/intake/capabilities'),env)).json();assert.equal(capabilities.canSubmit,true);
  const mcp=await(await worker.fetch(new Request('https://example.com/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env)).json();assert(mcp.result.tools.some(x=>x.name==='get_board_snapshot'));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM intake_requests').get().n,0);assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM intake_events').get().n,0);
});
