import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderProjectClarity, renderRequestInbox} from '../public/project-clarity.js';
import {workspaceDecisions, renderWorkspaceDecisions, decisionProjectId} from '../public/workspace-views.js';
import {createCandidateController, renderCandidateWorkspace} from '../public/candidate-workspace.js';

// Native details are real navigation, not CSS-hidden copies of the same page.
class Node {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.events={};this.className='';this.ownText='';this.classList={add:value=>this.className+=' '+value,contains:value=>this.className.split(/\s+/).includes(value)};}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('');}
  set innerHTML(_){throw Error('Unsafe HTML sink');}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.ownText='';this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(event,callback){this.events[event]=callback;}
  click(){if(!this.disabled)this.events.click?.();}
}
function setup(){const doc={createElement:tag=>new Node(tag,doc)};return doc.createElement('section');}
const walk=node=>[node,...node.children.flatMap(walk)];
const nodes=(root,cls)=>walk(root).filter(node=>node.classList.contains(cls));
function visibleText(node){if(node.hidden)return '';const children=node.tagName==='DETAILS'&&!node.open?node.children.filter(child=>child.tagName==='SUMMARY'):node.children;return node.ownText+children.map(visibleText).join('');}
const now=Date.parse('2026-10-11T12:00:00Z');
const board=()=>({projects:['Synthetic project'],tasks:[{id:'synthetic-task',project:'Synthetic project',title:'Review the demo',state:'blocked',observedAt:'2026-10-11T11:59:00Z',goal:'A detailed bounded goal',acceptanceCriteria:'A detailed acceptance criterion',observation:'Preview is ready to inspect',blocker:'The export is still missing',nextAction:'Check the export',assignedAgentIds:['synthetic-owner']}],agents:[{id:'synthetic-owner',name:'Assigned reviewer',kind:'reviewer',projectNames:['Synthetic project'],taskIds:['synthetic-task'],activity:{state:'unknown'}}]});

test('default project cards lead with progress while requirements, provenance and statistics stay reachable in details',()=>{
  const root=setup(),value=board(),before=structuredClone(value),opened=[];
  renderProjectClarity(root,value,null,{now,onTask:id=>opened.push(id),onAgent:id=>opened.push(id)});
  const visible=visibleText(root),card=nodes(root,'pc-task')[0],details=nodes(root,'pc-task-details')[0];
  for(const copy of ['Synthetic project','Preview is ready to inspect','The export is still missing','Check the export','Assigned reviewer'])assert(visible.includes(copy),copy);
  for(const copy of ['A detailed bounded goal','A detailed acceptance criterion','Agent 当前活动未核实','个有效业务项目'])assert(!visible.includes(copy),copy);
  assert.equal(details.tagName,'DETAILS');assert.equal(details.open,false);assert(card.children.indexOf(nodes(root,'pc-progress')[0])<card.children.indexOf(details));
  assert.equal(root.children[0].children[0].className,'pc-grid');
  details.open=true;details.events.toggle();renderProjectClarity(root,value,null,{now,onTask:id=>opened.push(id)});
  assert.equal(nodes(root,'pc-task-details')[0].open,true);assert(visibleText(root).includes('A detailed bounded goal'));assert(visibleText(root).includes('Agent 当前活动未核实'));
  nodes(root,'pc-footer')[0].children[0].click();assert.deepEqual(opened,['synthetic-task']);assert.deepEqual(value,before);
});

test('freshness, blockers and manual stop decisions remain visible after subtraction',()=>{
  const value=board();value.tasks[0].observedAt='2026-10-01T12:00:00Z';const root=setup();renderProjectClarity(root,value,null,{now});
  assert.match(visibleText(root),/历史导入记录/);assert.match(visibleText(root),/观察已过期，当前进展待核实/);assert.match(visibleText(root),/记录卡点/);
  value.tasks[0].manualStatus={state:'completed',version:1,source:'owner_manual',reason:'Owner confirmed this bounded result'};
  renderProjectClarity(root,value,null,{now});assert.match(visibleText(root),/已完成手动/);assert.match(visibleText(root),/Owner confirmed this bounded result/);assert.doesNotMatch(visibleText(root),/The export is still missing|Check the export/);
  assert.match(nodes(root,'pc-task-details')[0].textContent,/The export is still missing/);
});

const requests=['received','read','accepted','needs_confirmation','assigned','in_progress','blocked','completed','canceled','declined'].map((status,index)=>({id:'request-'+index,projectId:'p',projectName:'Synthetic project',status,body:'Synthetic '+status}));
test('only explicit human confirmation and proposed candidates enter the homepage decision area',()=>{
  const data={inbox:{requests},candidateEnabled:true,candidates:{records:[{id:'proposal',projectId:'p',status:'proposed'},{id:'done',projectId:'p',status:'approved'},{id:'rejected',projectId:'p',status:'rejected'}]}},before=structuredClone(data),opened=[],root=setup();
  const projection=workspaceDecisions(data);assert.deepEqual(projection.requests.map(item=>item.status),['needs_confirmation']);assert.deepEqual(projection.candidates.map(item=>item.id),['proposal']);
  renderWorkspaceDecisions(root,{...data,onRequest:request=>opened.push(request.id),onCandidates:()=>opened.push('approvals')});
  assert.equal(root.hidden,false);assert.match(visibleText(root),/1 项候选待审批/);assert.match(visibleText(root),/Synthetic needs_confirmation/);assert.doesNotMatch(visibleText(root),/Synthetic received|Synthetic blocked|Synthetic in_progress/);
  walk(root).find(node=>node.dataset.focusKey==='decisions:candidates').click();walk(root).find(node=>node.dataset.focusKey==='decisions:request:request-3').click();assert.deepEqual(opened,['approvals','request-3']);assert.deepEqual(data,before);
  renderWorkspaceDecisions(root,{...data,projectId:'other'});assert.equal(root.hidden,true);assert.equal(root.children.length,0);
});

test('ordinary waiting receipts remain readable in history without becoming user decisions or completing the project',()=>{
  const root=setup(),inbox={requests:requests.filter(item=>item.status!=='needs_confirmation'),pendingCount:3,unreadCount:1};
  renderWorkspaceDecisions(root,{inbox});assert.equal(root.hidden,true);assert.equal(root.textContent,'');
  renderRequestInbox(root,inbox);assert.match(root.textContent,/Synthetic received/);assert.match(root.textContent,/Synthetic read/);assert.match(root.textContent,/Synthetic accepted/);
  renderWorkspaceDecisions(root,{});assert.equal(root.hidden,true);assert.doesNotMatch(root.textContent,/完成|无需处理/);
});

test('decision pagination and stale-read notices do not silently drop later confirmations',()=>{
  const root=setup(),items=Array.from({length:4},(_,i)=>({id:'decision-'+i,projectId:'p',projectName:'Synthetic project',status:'needs_confirmation',body:'Decision '+i})),opened=[];
  const data={inbox:{requests:items},inboxError:'offline',candidateEnabled:true,candidates:{records:[{id:'p',status:'proposed'}],nextCursor:'opaque'}};
  renderWorkspaceDecisions(root,{...data,onRequest:item=>opened.push(item.id)});assert.match(visibleText(root),/1 项候选待审批 · 还有记录待查看/);assert.match(visibleText(root),/保留上次读取/);assert.doesNotMatch(visibleText(root),/Decision 3/);
  const more=nodes(root,'workspace-decision-more')[0];more.open=true;more.events.toggle();renderWorkspaceDecisions(root,{...data,onRequest:item=>opened.push(item.id)});
  assert.equal(nodes(root,'workspace-decision-more')[0].open,true);walk(root).find(node=>node.dataset.focusKey==='decisions:request:decision-3').click();assert.deepEqual(opened,['decision-3']);
});

test('decision text is plain and original request objects retain their exact identities',()=>{
  const request={id:'synthetic',status:'needs_confirmation',body:'<img src=x onerror=alert(1)>',projectName:'Synthetic'},root=setup();let opened;
  renderWorkspaceDecisions(root,{inbox:{requests:[request]},onRequest:value=>opened=value});assert(visibleText(root).includes(request.body));assert.equal(walk(root).filter(node=>node.tagName==='IMG').length,0);nodes(root,'wv-link')[0].click();assert.equal(opened,request);
});

test('homepage shell has one filter disclosure, no front-loaded inbox or diagnostics, and one primary add entry',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert(html.indexOf('id="project-roster"')<html.indexOf('id="request-inbox"'));assert(html.indexOf('data-workspace-view="projects"')<html.indexOf('data-workspace-view="approvals"'));
  assert.equal((html.match(/class="refresh primary-action"/g)||[]).length,1);assert.equal((html.match(/id="workspace-filters"/g)||[]).length,1);
  assert.match(html,/<details id="workspace-filters" class="workspace-filters"><summary>/);assert.match(html,/<details id="request-inbox-panel" class="request-inbox-details"><summary>跨项目待处理记录/);
  const technical=html.slice(html.indexOf('<details class="workspace-system-details">'));for(const id of ['source','coverage','project-context-note','workspace-capability-state'])assert(technical.includes('id="'+id+'"'));
  assert(!html.includes('class="sidebar-note"'));assert(!html.includes('id="summary"'));assert(!html.includes('class="workspace-context"'));
});

const candidate={schemaVersion:'dot-board.candidate/1',id:'synthetic-candidate',clientSubmissionId:'synthetic-event',projectId:'p',contextTaskId:'synthetic-task',title:'Inspect the prototype',reason:'The next review is useful',expectedOutcome:'One verified artifact',sourceReferences:[{kind:'web',label:'Public source',reference:'https://example.com/source'}],dueAt:null,area:'Synthetic area',viewedSnapshotRevision:'sha256:synthetic-revision',viewedSnapshotImportedAt:'2026-10-11T12:00:00Z',contextStale:false,status:'proposed',version:1,createdAt:'2026-10-11T12:00:00Z',updatedAt:'2026-10-11T12:00:00Z',review:null,requestId:null};
test('candidate actions precede collapsed source details and optional notes survive rerender without enabling execution',async()=>{
  const calls=[],controller=createCandidateController({requestJson:async(url,options)=>{calls.push([url,options]);return {candidate};}});await controller.select(candidate.id);
  const root=setup(),options={enabled:true,capabilities:{canPropose:true,canReview:true},projects:[{id:'p',name:'Synthetic project'}],tasks:board().tasks};renderCandidateWorkspace(root,controller,options);
  const detail=nodes(root,'cw-detail')[0],context=nodes(root,'cw-context-details')[0],note=nodes(root,'cw-review-note')[0],visible=visibleText(detail);
  for(const copy of [candidate.title,candidate.reason,candidate.expectedOutcome,'批准并保存需求','拒绝'])assert(visible.includes(copy),copy);
  for(const copy of ['https://example.com/source','sha256:synthetic-revision','Synthetic area','关联任务'])assert(!visible.includes(copy),copy);
  assert.equal(context.open,false);assert.equal(note.open,false);assert(detail.children.indexOf(nodes(root,'cw-review-actions')[0])<detail.children.indexOf(context));
  assert.match(visibleText(root),/批准只保存需求，实际执行另需授权/);assert.match(context.textContent,/不入执行队列，也不调用 Events/);
  context.open=true;context.events.toggle();note.open=true;note.events.toggle();const input=walk(note).find(node=>node.tagName==='TEXTAREA');input.value='Keep this decision note';input.events.input();renderCandidateWorkspace(root,controller,options);
  assert.equal(nodes(root,'cw-context-details')[0].open,true);assert.equal(nodes(root,'cw-review-note')[0].open,true);assert.equal(walk(nodes(root,'cw-review-note')[0]).find(node=>node.tagName==='TEXTAREA').value,'Keep this decision note');
  assert(calls.every(([,options])=>options===undefined));
});


test('a partial page with no current decisions retains honest routes to unread records',()=>{
  const root=setup(),opened=[],data={inbox:{requests:[requests[0]],nextCursor:'inbox-next'},candidateEnabled:true,candidates:{records:[{id:'done',status:'approved'}],nextCursor:'candidate-next',filter:'approved'}};
  renderWorkspaceDecisions(root,{...data,onCandidates:()=>opened.push('candidates'),onRequestHistory:()=>opened.push('requests')});
  assert.equal(root.hidden,false);assert.match(visibleText(root),/还有记录待查看/);assert.doesNotMatch(visibleText(root),/需要你决定|0 项|全部完成/);
  walk(root).find(node=>node.dataset.focusKey==='decisions:candidates').click();walk(root).find(node=>node.dataset.focusKey==='decisions:request-history').click();assert.deepEqual(opened,['candidates','requests']);
  assert.equal(workspaceDecisions({...data,projectId:'other'}).candidatePartial,true);
  renderWorkspaceDecisions(root,{inbox:{requests:[]},candidateEnabled:true,candidates:{records:[]}});assert.equal(root.hidden,true);
});

test('approval filter does not suppress known proposals and an unregistered project cannot borrow another ID',()=>{
  const data={candidateEnabled:true,candidates:{records:[{id:'pending',status:'proposed',projectId:'p'}],filter:'approved'},inbox:{requests:[requests[3]]}};
  assert.equal(workspaceDecisions(data).candidates.length,1);assert.equal(workspaceDecisions({...data,projectId:''}).candidates.length,0);assert.equal(workspaceDecisions({...data,projectId:''}).requests.length,0);
});

test('a filtered partial candidate list does not claim that the entire category is empty',()=>{
  const root=setup(),controller=createCandidateController(),state=controller.getState();state.loaded=true;state.nextCursor='opaque';state.filter='proposed';state.records=[{...candidate,status:'approved'}];
  renderCandidateWorkspace(root,controller,{enabled:true,capabilities:{canPropose:true,canReview:true}});
  assert.match(visibleText(root),/当前已读取记录中没有这一类，加载更多继续查看/);assert.doesNotMatch(visibleText(root),/这个分类还没有候选/);
});


test('project decision scope resolves unique aliases and never falls back from an unknown project to all',()=>{
  const projects=[{id:'stable-one',name:'Primary label',names:['Primary label','Secondary alias']},{id:'stable-two',names:['Another project']},{id:null,names:['Unregistered legacy']}];
  assert.equal(decisionProjectId(projects,''),null);assert.equal(decisionProjectId(projects,'Secondary alias'),'stable-one');assert.equal(decisionProjectId(projects,'Unregistered legacy'),'');assert.equal(decisionProjectId(projects,'Missing name'),'');
  assert.equal(decisionProjectId([...projects,{id:'conflicting',names:['Secondary alias']}],'Secondary alias'),'');
  const data={inbox:{requests:[{id:'other',projectId:'stable-two',status:'needs_confirmation'}]}};
  assert.equal(workspaceDecisions({...data,projectId:decisionProjectId(projects,'Secondary alias')}).requests.length,0);
  assert.equal(workspaceDecisions({...data,projectId:decisionProjectId(projects,'Unregistered legacy')}).requests.length,0);
});

test('long decision previews remain compact while opening the untouched full receipt',()=>{
  const root=setup(),body='🧪'.repeat(6000),request={id:'long',status:'needs_confirmation',body};let opened;
  renderWorkspaceDecisions(root,{inbox:{requests:[request]},onRequest:value=>opened=value});const preview=nodes(root,'wv-link')[0];assert.equal(Array.from(preview.textContent).length,91);assert(preview.textContent.endsWith('…'));preview.click();assert.equal(opened,request);assert.equal(Array.from(opened.body).length,6000);
});

test('first-read failures stay visible as uncertainty with a retry instead of an empty decision area',()=>{
  const root=setup(),retried=[];renderWorkspaceDecisions(root,{inboxError:'offline',onRetryRequests:()=>retried.push('requests')});
  assert.equal(root.hidden,false);assert.match(visibleText(root),/待决定记录暂不可用/);assert.doesNotMatch(visibleText(root),/0 项|全部完成|需要你决定/);walk(root).find(node=>node.dataset.focusKey==='decisions:retry-requests').click();assert.deepEqual(retried,['requests']);
  renderWorkspaceDecisions(root,{inboxError:'offline',inboxLoading:true});assert(walk(root).find(node=>node.dataset.focusKey==='decisions:retry-requests').disabled);
  renderWorkspaceDecisions(root,{candidateEnabled:true,candidates:{records:[],error:'offline'},onRetryCandidates:()=>retried.push('candidates')});assert.equal(root.hidden,false);walk(root).find(node=>node.dataset.focusKey==='decisions:retry-candidates').click();assert.deepEqual(retried,['requests','candidates']);
});

test('app decision shortcuts explicitly choose proposed candidates and the unique project resolver',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/projectId:decisionProjectId\(requestChoices\(\),ui.project\)/);assert.match(app,/onCandidates:\(\)=>\{candidateController.setFilter\('proposed'\);selectWorkspace\('approvals'\)/);
});
