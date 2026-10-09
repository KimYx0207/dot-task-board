import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollaborationModel, observationFreshness, renderCollaborationGraph, layoutCollaboration, dotIconURI} from '../public/collaboration-graph.js';
const now=Date.parse('2026-10-07T07:00:00Z');
const root={id:'root',name:'dot',type:'agent',relationshipState:'known',parentAgentId:null,projectNames:[],activity:{state:'running',observedAt:'2026-10-07T06:59:00Z'}};
const worker={id:'worker',name:'执行者',type:'subagent',relationshipState:'known',parentAgentId:'root',projectNames:['项目 A'],taskIds:['t1'],activity:{state:'running',observedAt:'2026-10-07T06:59:00Z'},latestResult:{summary:'已检查文件'}};
const fixture=()=>({agents:[structuredClone(root),structuredClone(worker)],tasks:[{id:'t1',title:'验收任务',project:'项目 A'}]});
test('only explicit parent relationships become edges; snapshots never animate',()=>{
 const model=createCollaborationModel(fixture(),{now});assert.equal(model.edges.length,1);assert.equal(model.edges[0].kind,'parent');assert.equal(model.nodes[1].latestResult,'已检查文件');assert.ok([...model.nodes,...model.edges].every(n=>n.animate===false));assert.equal(model.mode,'snapshot');
});
test('role-only tasks do not create agents or links',()=>{const m=createCollaborationModel({tasks:[{id:'x',ownerRole:'执行'}]},{now});assert.deepEqual(m.nodes,[]);assert.deepEqual(m.edges,[]);});
test('project scope includes parents as context and only matching task links',()=>{const b=fixture();b.tasks.push({id:'t2',title:'其他',project:'项目 B',assignedAgentIds:['worker']});const m=createCollaborationModel(b,{now,project:'项目 A'});assert.equal(m.nodes[0].contextOnly,true);assert.equal(m.nodes[1].contextOnly,false);assert.deepEqual(m.nodes[1].tasks,[{id:'t1',title:'验收任务'}]);});
test('task associations also establish project membership, without creating a parent',()=>{const b=fixture();b.agents[1].projectNames=[];const m=createCollaborationModel(b,{now,project:'项目 A'});assert.equal(m.nodes.length,2);assert.equal(m.edges.length,1);});
test('unknown, missing, future and stale observations cannot imply active execution',()=>{
 for(const observedAt of [null,'invalid','2026-10-07T07:06:00Z','2026-10-06T07:00:00Z']){const b=fixture();b.agents[1].activity.observedAt=observedAt;const n=createCollaborationModel(b,{now}).nodes[1];assert.equal(n.statusLabel,'上次记录执行');assert.equal(n.animate,false);}
 assert.equal(observationFreshness('2026-10-07T06:59:00Z',now),'current');assert.equal(observationFreshness(null,now),'unknown');
});
test('freshness changes when time advances without a new snapshot',()=>{const b=fixture();assert.equal(createCollaborationModel(b,{now}).nodes[1].freshness,'current');assert.equal(createCollaborationModel(b,{now:now+3*3600000}).nodes[1].freshness,'stale');});
test('unknown relationships, missing parents and self cycles do not draw edges',()=>{for(const changes of [{relationshipState:'unknown'},{parentAgentId:'absent'},{parentAgentId:'worker'}]){const b=fixture();Object.assign(b.agents[1],changes);const m=createCollaborationModel(b,{now});assert.equal(m.edges.length,0);assert.equal(m.nodes[1].relation,'unknown');}});
test('multi-node cycles fail closed while keeping visible records',()=>{const b=fixture();b.agents[0].parentAgentId='worker';const m=createCollaborationModel(b,{now});assert.equal(m.edges.length,0);assert.equal(m.invalidRelationshipCount,2);assert.ok(m.nodes.every(n=>n.relation==='unknown'));});
test('duplicate agent identities are excluded rather than arbitrarily selected',()=>{const b=fixture();b.agents.push({...worker,name:'冒名'});const m=createCollaborationModel(b,{now});assert.equal(m.nodes.length,1);assert.equal(m.duplicateCount,1);assert.equal(m.edges.length,0);});
test('missing task references are explicitly counted',()=>{const b=fixture();b.agents[1].taskIds.push('missing');const n=createCollaborationModel(b,{now}).nodes[1];assert.equal(n.unresolvedTaskCount,1);assert.equal(n.tasks.length,1);});
test('unknown status is not silently coerced to running',()=>{const b=fixture();b.agents[1].activity.state='launching';assert.equal(createCollaborationModel(b,{now}).nodes[1].state,'unknown');});
// Minimal DOM contract verifies safe text sinks and semantic actions without a browser.
class Element {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.listeners={};this.attributes={};this.className='';this.textContent='';this.clientWidth=1200;this.classList={add:name=>{this.className+=' '+name;},toggle:(name,on)=>{this.className=this.className.replace(name,'');if(on)this.className+=' '+name;}};}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;} setAttribute(k,v){this.attributes[k]=String(v);} getAttribute(k){return this.attributes[k];} addEventListener(k,v){this.listeners[k]=v;}
 set innerHTML(_){throw Error('Unsafe HTML sink');}
}
const doc={createElement:tag=>new Element(tag,doc),createElementNS:(_,tag)=>new Element(tag,doc),defaultView:{requestAnimationFrame:fn=>fn()}};
const walk=n=>[n,...n.children.flatMap(walk)];
test('canvas renders untrusted names as text and actions retain verified IDs',()=>{
 const b=fixture();b.agents[1].name='<img src=x onerror=alert(1)>';const container=new Element('div',doc),calls=[];
 renderCollaborationGraph(container,createCollaborationModel(b,{now}),{onAgent:id=>calls.push(['agent',id]),onTask:id=>calls.push(['task',id]),onProject:id=>calls.push(['project',id])});
 const all=walk(container),buttons=all.filter(n=>n.tagName==='button');assert.ok(buttons.every(n=>n.type==='button'));assert.ok(all.some(n=>n.textContent===b.agents[1].name));assert.equal(all.filter(n=>n.tagName==='script').length,0);assert.ok(all.filter(n=>n.tagName==='img').every(n=>n.src.startsWith('data:image/svg+xml,')));
 buttons.find(n=>n.dataset.focusKey==='canvas:task:'+JSON.stringify(['worker','t1'])).listeners.click();buttons.find(n=>n.dataset.focusKey==='canvas:project:项目 A').listeners.click();buttons.find(n=>n.dataset.focusKey==='canvas:agent:worker').listeners.click();assert.deepEqual(calls,[['task','t1'],['project','项目 A'],['agent','worker']]);
});
test('missing handlers disable semantic actions while keeping real view controls',()=>{const c=new Element('div',doc);renderCollaborationGraph(c,createCollaborationModel(fixture(),{now}));const buttons=walk(c).filter(n=>n.tagName==='button');assert.ok(buttons.filter(n=>/^canvas:(agent|task):/.test(n.dataset.focusKey)).every(n=>n.disabled));assert.ok(buttons.some(n=>n.dataset.focusKey==='canvas:in'));assert.equal(walk(c).filter(n=>n.tagName==='a').length,0);});
test('empty scoped graph gives a useful empty state and no fake Agent',()=>{const c=new Element('div',doc);renderCollaborationGraph(c,createCollaborationModel(fixture(),{now,project:'不存在'}));assert.ok(walk(c).some(n=>n.textContent.startsWith('没有符合筛选条件的 Agent')));assert.equal(walk(c).filter(n=>n.dataset.agentId).length,0);});
test('search/status selection is respected with ancestors only as labeled context',()=>{const b=fixture();const m=createCollaborationModel(b,{now,visibleAgentIds:['worker']});assert.equal(m.nodes.length,2);assert.equal(m.nodes[0].contextOnly,true);assert.equal(m.nodes[1].contextOnly,false);assert.equal(m.edges.length,1);});
test('empty search/status results produce an empty graph',()=>{assert.deepEqual(createCollaborationModel(fixture(),{now,visibleAgentIds:[]}).nodes,[]);});
test('graph action focus keys remain stable across redraws',()=>{const c=new Element('div',doc),handlers={onAgent:()=>{},onTask:()=>{},onProject:()=>{}};const m=createCollaborationModel(fixture(),{now});renderCollaborationGraph(c,m,handlers);const first=walk(c).filter(n=>n.tagName==='button').map(n=>n.dataset.focusKey);renderCollaborationGraph(c,m,handlers);assert.deepEqual(walk(c).filter(n=>n.tagName==='button').map(n=>n.dataset.focusKey),first);assert.ok(first.every(k=>k?.startsWith('canvas:')));});
test('shared tasks and projects have unique per-card keyboard focus identities',()=>{const b=fixture();b.agents.push({...worker,id:'other',name:'另一个执行者'});const c=new Element('div',doc);renderCollaborationGraph(c,createCollaborationModel(b,{now}),{onAgent:()=>{},onTask:()=>{},onProject:()=>{}});const keys=walk(c).filter(n=>n.tagName==='button').map(n=>n.dataset.focusKey);assert.equal(new Set(keys).size,keys.length);});


test('graph projection suppresses private labels from every displayed source field',()=>{
 const b=fixture(),a=b.agents[1];a.name='__external_private_worker';a.activity.summary='__external_private_work_details';a.latestResult.summary='__external_private_result';a.projectNames=['__external_private_project','项目 A'];b.tasks[0].title='__external_private_task';
 const model=createCollaborationModel(b,{now}),n=model.nodes.find(n=>n.id==='worker');
 assert.equal(n.name,'未命名 Agent');assert.equal(n.summary,'');assert.equal(n.latestResult,'');assert.deepEqual(n.projects,['项目 A']);assert.equal(n.tasks[0].title,'未命名任务');assert(!JSON.stringify(model).includes('__external_'));
});

test('renderer also guards direct models and derived accessibility labels',()=>{
 const model=createCollaborationModel(fixture(),{now});
 for(const n of model.nodes){n.name='__external_private_worker';n.summary='/workspace/private';n.latestResult='system prompt private';n.projects=['__external_private_project'];n.tasks=[{id:'t1',title:'__external_private_task'}];n.observedAt='__external_private_time';}
 const c=new Element('div',doc);renderCollaborationGraph(c,model,{onAgent:()=>{},onProject:()=>{},onTask:()=>{}});
 const text=walk(c).map(n=>n.textContent+' '+JSON.stringify(n.attributes)+' '+JSON.stringify(n.dataset)).join(' ');
 for(const marker of ['__external_','/workspace/','system prompt'])assert(!text.includes(marker),marker);
 assert.ok(walk(c).filter(n=>n.tagName==='button').every(n=>!JSON.stringify(n.dataset).includes('__external_')));
});


test('opt-in guide animation is clearly distinct from activity and zoom controls work',()=>{const c=new Element('div',doc);renderCollaborationGraph(c,createCollaborationModel(fixture(),{now}),{onAgent:()=>{}});const all=walk(c),buttons=all.filter(n=>n.tagName==='button');assert.ok(all.some(n=>n.textContent==='动效仅作路径导览，不代表正在执行'));const tour=buttons.find(n=>n.dataset.focusKey==='canvas:tour');assert.equal(tour.attributes['aria-pressed'],'false');tour.listeners.click();assert.equal(tour.attributes['aria-pressed'],'true');const zoom=all.find(n=>n.tagName==='output'),before=zoom.textContent;buttons.find(n=>n.dataset.focusKey==='canvas:in').listeners.click();assert.notEqual(zoom.textContent,before);});
test('layout preserves every real identity and avoids node overlap across projects',()=>{const b=fixture();b.agents.push(...Array.from({length:98},(_,i)=>({...worker,id:'w'+i,projectNames:['P'+(i%8)]})));const l=layoutCollaboration(createCollaborationModel(b,{now}));assert.equal(l.nodes.length,100);assert.equal(new Set(l.nodes.map(n=>n.id)).size,100);for(const n of l.nodes){assert(n.x>=0&&n.x+150<=l.width);assert(n.y>=0&&n.y+150<=l.height);}for(let i=0;i<l.nodes.length;i++)for(let j=i+1;j<l.nodes.length;j++){const a=l.nodes[i],b=l.nodes[j];assert(Math.abs(a.x-b.x)>=150||Math.abs(a.y-b.y)>=200);}});
test('all icon variants use a project-owned circle and contain no executable content',()=>{for(const kind of ['coordinator','reviewer','researcher','owner']){const icon=decodeURIComponent(dotIconURI(kind).split(',').slice(1).join(','));assert(icon.includes('<circle cx="44" cy="44" r="19"'));assert(!icon.includes('M40.0391'));assert(!/<script|onload=|onerror=|<foreignObject/i.test(icon));}});


test('ancestor context task selection survives filters but unlinked task selections do not',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const fn=app.slice(app.indexOf('function ensureSelection('),app.indexOf('\nfunction renderRows('));
 for(const linked of [true,false]){const ui={view:'agents',selected:{type:'task',id:'root-task'},fromAgent:'root'};const context={ui,rows:[{id:'child'}],taskById:id=>id==='root-task'?{id}:null,agentById:id=>id==='root'?{id}:null,agentTasks:()=>linked?[{id:'root-task'}]:[],matchesAgentFilter:()=>false};runInNewContext(fn+';ensureSelection(rows)',context);assert.equal(ui.selected.type,linked?'task':'agent');assert.equal(ui.selected.id,linked?'root-task':'child');}
});

test('initial canvas places coordinator and first project agents together without an empty vertical lane',()=>{const l=layoutCollaboration(createCollaborationModel(fixture(),{now}));const a=l.nodes.find(n=>n.id==='root'),b=l.nodes.find(n=>n.id==='worker');assert(Math.abs(a.y-b.y)<80);assert(b.y<200);assert(l.width<800);});
