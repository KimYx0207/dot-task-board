import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {taskClarity,renderProjectClarity,renderRequestInbox,utcTime,createManualStatusController,clarityBoard,renderManualStatusForm,presentationScope,taskPresentationKind,projectPresentationKind,ownerObservationLabel,presentationBoard} from '../public/project-clarity.js';
class Node {
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.events=new Map();this.className='';this.ownText='';this.classList={add:v=>{this.className+=' '+v;},contains:v=>this.className.split(/\s+/).includes(v)};}
 set textContent(value){this.ownText=String(value);this.children=[];}get textContent(){return this.ownText+this.children.map(n=>n.textContent).join('');}
 set innerHTML(_){throw Error('Unsafe HTML insertion');}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.ownText='';this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}
 addEventListener(k,fn){const list=this.events.get(k)||[];list.push(fn);this.events.set(k,list);}
 fire(k){for(const fn of this.events.get(k)||[])fn({target:this});}click(){this.fire('click');}
}
function setup(){const doc={createElement:tag=>new Node(tag,doc)};return doc.createElement('section');}
const walk=n=>[n,...n.children.flatMap(walk)],nodes=(root,cls)=>walk(root).filter(n=>n.classList.contains(cls));
const now=Date.parse('2026-10-08T11:00:00Z');
const input=()=>({projects:['Alpha','Beta'],tasks:[{id:'a',title:'Verify application',project:'Alpha',state:'partial',observedAt:'2026-10-08T10:59:00Z',observation:'The service starts and returns a successful response.',blocker:'The graphical interface still needs verification.',nextAction:'Verify the existing interface.',assignedAgentIds:['owner','reviewer']}],agents:[{id:'owner',name:'Original owner',taskIds:['a'],projectNames:['Alpha'],activity:{state:'running',observedAt:'2026-10-08T10:59:00Z'}},{id:'reviewer',name:'Reviewer',taskIds:['a'],projectNames:['Alpha'],activity:{state:'unknown'}}]});
const queue=(changes={})=>({enabled:true,jobs:[{id:'check',projectId:'p-alpha',projectName:'Alpha',originalTaskContext:{taskId:'a'},threadBound:true,state:'completed',observedAt:'2026-10-08T10:59:00Z',summary:'Read-only query completed; application unchanged.',title:'Read-only verification',...changes}]});

test('assignment records neither establish a thread nor imply running',()=>{const b=input(),c=taskClarity(b.tasks[0],b,null,now);assert.equal(c.status,'部分完成');assert.equal(c.owners.length,2);assert.equal(c.threadVerified,false);const root=setup();renderProjectClarity(root,b,null,{now});assert.match(root.textContent,/Original owner/);assert.match(root.textContent,/Reviewer/);assert.doesNotMatch(root.textContent,/当前执行未核实|尚未确认/);assert.doesNotMatch(root.textContent,/原线程已绑定|正在执行/);});
test('queue context requires exact task and project and excludes historical validation',()=>{const b=input();for(const q of [queue({projectName:'Beta'}),queue({originalTaskContext:{taskId:'wrong'}}),queue({projectId:'validation'}),{...queue(),enabled:false}])assert.equal(taskClarity(b.tasks[0],b,q,now).execution,null);assert.equal(taskClarity(b.tasks[0],b,queue(),now).threadVerified,true);});
test('only typed unexpired execution evidence is running',()=>{const b=input(),proof={state:'running',effectiveState:'running',evidenceType:'tool_result',lastExecutionObservedAt:'2026-10-08T10:59:00Z',evidenceExpiresAt:'2026-10-08T11:04:00Z'};assert.equal(taskClarity(b.tasks[0],b,queue(proof),now).status,'正在执行');for(const edit of [{evidenceType:'started'},{evidenceExpiresAt:null},{lastExecutionObservedAt:'2026-10-08T11:01:00Z'}])assert.notEqual(taskClarity(b.tasks[0],b,queue({...proof,...edit}),now).status,'正在执行');assert.notEqual(taskClarity(b.tasks[0],b,queue(proof),Date.parse(proof.evidenceExpiresAt)).status,'正在执行');});
test('a finished request does not complete its project task',()=>{const b=input(),root=setup();renderProjectClarity(root,b,queue(),{now});assert.equal(nodes(root,'pc-status')[0].textContent,'部分完成');assert.match(root.textContent,/最近一次执行已返回结果/);assert.match(root.textContent,/不代表整个项目已完成/);assert.match(root.textContent,/Read-only query completed/);});
test('paused and canceled tasks never repeat an old instruction to resume',()=>{for(const state of ['paused','canceled']){const b=input();b.tasks[0].state=state;b.tasks[0].nextAction='Resume and publish now';const root=setup();renderProjectClarity(root,b,queue(),{now});assert.doesNotMatch(root.textContent,/Resume and publish now/);assert.match(root.textContent,/已暂停|已取消/);assert.match(root.textContent,/保持暂停|不再继续/);}});
test('raw recorded running without a concrete receipt stays unverified',()=>{const b=input();b.tasks[0].state='running';assert.equal(taskClarity(b.tasks[0],b,null,now).status,'近况待核实');});
test('project and task counts remain distinct under a project selection',()=>{const root=setup();renderProjectClarity(root,input(),null,{now,project:'Alpha'});assert.equal(nodes(root,'pc-project').length,1);assert.match(nodes(root,'pc-scope')[0].textContent,/当前项目 · 1 项登记任务/);renderProjectClarity(root,input(),null,{now});assert.match(nodes(root,'pc-scope')[0].textContent,/1 个有效业务项目 · 1 项业务任务/);});
test('content-type selector controls the visible objects',()=>{const root=setup();renderProjectClarity(root,input(),null,{now,contentType:'tasks'});assert.equal(nodes(root,'pc-task').length,1);assert.equal(nodes(root,'pc-owner').length,0);renderProjectClarity(root,input(),null,{now,contentType:'agents'});assert.equal(nodes(root,'pc-task').length,0);assert.equal(nodes(root,'pc-roster-person').length,2);});
test('project, task, owner and evidence controls keep actual identities',()=>{const root=setup(),actions=[];renderProjectClarity(root,input(),null,{now,onProject:id=>actions.push(['project',id]),onTask:id=>actions.push(['task',id]),onAgent:id=>actions.push(['owner',id])});nodes(root,'pc-project-head')[0].children[0].children[0].click();nodes(root,'pc-task-title')[0].click();nodes(root,'pc-owner')[0].children[1].click();nodes(root,'pc-footer')[0].children[0].click();assert.deepEqual(actions,[['project','Alpha'],['task','a'],['owner','owner'],['task','a']]);});
test('disclosures remain open after background rendering and have stable focus keys',()=>{const root=setup();renderProjectClarity(root,input(),queue(),{now});for(const cls of ['pc-receipt','pc-blocker']){const detail=nodes(root,cls)[0];assert(detail.children[0].dataset.focusKey);detail.open=true;detail.fire('toggle');}renderProjectClarity(root,input(),queue(),{now});assert.equal(nodes(root,'pc-receipt')[0].open,true);assert.equal(nodes(root,'pc-blocker')[0].open,true);});
test('empty filtered results can clear filters without inventing records',()=>{const root=setup();let cleared=false;renderProjectClarity(root,input(),null,{now,query:'does not exist',onClear:()=>{cleared=true;}});assert.equal(nodes(root,'pc-task').length,0);assert.match(root.textContent,/没有匹配/);nodes(root,'pc-link')[0].click();assert.equal(cleared,true);});
test('source observation clocks are stable, timezone explicit, and bad timestamps disclosed',()=>{assert.equal(utcTime('2026-10-08T10:59:00Z'),'10-08 10:59 UTC');assert.equal(utcTime(null),'时间未记录');const b=input(),before=structuredClone(b);b.tasks[0].observedAt='2026-10-08T13:00:00Z';assert.equal(taskClarity(b.tasks[0],b,null,now).freshness,'future');const root=setup();renderProjectClarity(root,b,null,{now});assert.match(root.textContent,/时间待核实/);assert.equal(b.tasks[0].observedAt,'2026-10-08T13:00:00Z');assert.equal(before.tasks[0].observedAt,'2026-10-08T10:59:00Z');});
test('frontend drops internal source labels instead of echoing them',()=>{const b=input();b.tasks[0].observation='/workspace/private/secret';b.tasks[0].blocker='/user_notes/private';b.agents[0].name='/root/private';const root=setup();renderProjectClarity(root,b,null,{now});assert.doesNotMatch(root.textContent,/\/workspace\/|\/user_notes\/|\/root\//);});
test('inbox displays saved/read state without claiming the work is done or acknowledging it',()=>{const root=setup(),value={unreadCount:1,pendingCount:2,requests:[{id:'r1',projectId:'alpha',projectName:'Alpha',body:'Please revise the deliverable',status:'received',createdAt:'2026-10-08T10:59:00Z'},{id:'r2',projectId:'beta',projectName:'Beta',body:'Please inspect the result',status:'read',createdAt:'2026-10-08T10:58:00Z'}]},before=structuredClone(value),opened=[];renderRequestInbox(root,value,{onOpen:receipt=>opened.push(receipt.id)});assert.match(root.textContent,/1 条待读取 · 2 条待处理/);assert.match(root.textContent,/已收到 · 待读取/);assert.match(root.textContent,/已读取 · 待处理/);assert.doesNotMatch(root.textContent,/任务已完成/);nodes(root,'inbox-open')[0].click();assert.deepEqual(opened,['r1']);assert.deepEqual(value,before);});
test('failed inbox reads preserve the last records and provide retry',()=>{const root=setup();let retried=false;renderRequestInbox(root,{requests:[],unreadCount:0,pendingCount:0},{error:'network',onRetry:()=>{retried=true;}});assert.match(root.textContent,/保留上次读取/);nodes(root,'pc-link')[0].click();assert.equal(retried,true);});
test('inbox client is read-only and refreshes after user submission',async()=>{const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');assert.match(source,/requestJson\('\/api\/intake\/inbox'\+/);const fn=source.slice(source.indexOf('async function loadInbox'),source.indexOf('function openInboxRequest'));assert.doesNotMatch(fn,/POST|PATCH|PUT|acknowledge/);assert.match(source,/finally\{intake.submitting.delete\(key\);renderIntake\(\);void loadInbox\(\);\}/);});

test('inbox pagination and accepted state remain actionable without changing status',()=>{const root=setup();let more=0;renderRequestInbox(root,{requests:[{id:'accepted',body:'An accepted request',projectName:'Alpha',status:'accepted'}],pendingCount:70,unreadCount:2,truncated:true,nextCursor:'opaque'}, {onMore:()=>more++});assert.match(root.textContent,/已受理/);assert.match(root.textContent,/70 条待处理/);walk(root).find(n=>n.dataset.focusKey==='inbox:more-page').click();assert.equal(more,1);});

const statusResult=(taskId,version,state,extra={})=>({taskId,version,state,source:'owner_manual',updatedAt:'2026-10-08T11:00:00Z',executionControl:{state:'active',version:0},...extra});
test('unsupported manual status renders a badge without an editable quick-state control',()=>{const b=input(),root=setup();let requests=0;const controller=createManualStatusController({supported:()=>false,requestJson:async()=>{requests++;throw Error('unexpected request');}});renderProjectClarity(root,b,null,{now,statusController:controller});assert.equal(nodes(root,'pc-status-select').length,0);assert.equal(nodes(root,'pc-status').length,b.tasks.length);assert(nodes(root,'pc-status').every(node=>node.tagName==='SPAN'));assert.equal(requests,0);});
test('manual progress is a task label, never fresh execution evidence',()=>{const b=input();b.tasks[0].manualStatus={state:'running',version:1,source:'owner_manual'};const c=taskClarity(b.tasks[0],b,null,now);assert.equal(c.status,'进行中');assert.equal(c.executionState,null);const root=setup();renderProjectClarity(root,b,null,{now});assert.match(nodes(root,'pc-status')[0].textContent,/进行中手动/);assert.doesNotMatch(root.textContent,/正在执行|有新执行回执/);});
test('external pause overrides an older manual running label and filters',()=>{const b=input();b.tasks[0].state='paused';b.tasks[0].manualStatus={state:'running',version:2,source:'owner_manual'};assert.equal(taskClarity(b.tasks[0],b,null,now).status,'已暂停');assert.equal(clarityBoard(b).tasks[0].state,'paused');});
test('manual completion participates in filters without replacing observations or acceptance',()=>{const b=input(),observed=b.tasks[0].observedAt;b.tasks[0].manualStatus={state:'completed',version:1,source:'owner_manual'};const root=setup();renderProjectClarity(root,b,null,{now,taskState:'completed'});assert.equal(nodes(root,'pc-task').length,1);assert.match(nodes(root,'pc-status')[0].textContent,/已完成手动/);assert.equal(b.tasks[0].state,'partial');assert.equal(b.tasks[0].observedAt,observed);});
test('broken legacy relation placeholders are omitted without mutating source records',()=>{const b=input();b.tasks[0].assignedAgentIds=[];b.agents=[];b.tasks[0].observation='本轮未找到可验证的原任务映射或最新执行证据。';b.tasks[0].blocker=b.tasks[0].observation;b.tasks[0].nextAction='核验原任务后再行动，不启动替代任务';const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});assert.equal(nodes(root,'pc-owner').length,0);assert.equal(nodes(root,'pc-blocker').length,0);assert.doesNotMatch(root.textContent,/未找到可验证|无法关联|尚未确认|当前执行未核实/);assert.deepEqual(b,before);});
test('status reads do not turn a missing manual record into queued',async()=>{const task=input().tasks[0],calls=[];const controller=createManualStatusController({requestJson:async(url,options)=>{calls.push([url,options]);return statusResult(task.id,0,null);}});await controller.open(task);assert.equal(controller.get(task.id).draft,'');assert.equal(controller.get(task.id).data.state,null);assert.equal(calls.length,1);assert.equal(calls[0][1],undefined);});
test('manual save uses the exact current version, status, identity and optional reason',async()=>{const task=input().tasks[0],posts=[],saved=[];const controller=createManualStatusController({uuid:()=> 'event-one',onSaved:(id,result)=>saved.push([id,result]),requestJson:async(url,options)=>{if(!options)return statusResult(task.id,0,null);posts.push(JSON.parse(options.body));return statusResult(task.id,1,'completed');}});await controller.open(task);controller.choose(task.id,'completed');controller.reason(task.id,'Owner update');await controller.save(task);assert.deepEqual(posts,[{expectedVersion:0,eventId:'event-one',state:'completed',reason:'Owner update'}]);assert.equal(controller.get(task.id).message,'已保存');assert.equal(saved[0][0],task.id);assert.equal(task.state,'partial');});
test('uncertain status saves retry byte-identical payload and block editing until resolved',async()=>{const task=input().tasks[0],payloads=[];let attempts=0;const controller=createManualStatusController({uuid:()=> 'same-event',requestJson:async(url,options)=>{if(!options)return statusResult(task.id,0,null);payloads.push(options.body);if(++attempts===1)throw Error('network');return {...statusResult(task.id,1,'completed'),duplicate:true};}});await controller.open(task);controller.choose(task.id,'completed');await controller.save(task);controller.choose(task.id,'running');assert.equal(controller.get(task.id).draft,'completed');await controller.save(task);assert.equal(payloads[0],payloads[1]);assert.equal(controller.get(task.id).submission,null);});
test('rapid repeated status clicks never create parallel writes',async()=>{const task=input().tasks[0];let resolve,posts=0;const controller=createManualStatusController({uuid:()=> 'event',requestJson:async(url,options)=>{if(!options)return statusResult(task.id,0,null);posts++;return new Promise(r=>resolve=r);}});await controller.open(task);controller.choose(task.id,'completed');const saving=controller.save(task);await controller.save(task);assert.equal(posts,1);resolve(statusResult(task.id,1,'completed'));await saving;});
test('version conflict requires deliberate reread and never automatically overwrites',async()=>{const task=input().tasks[0];let reads=0,posts=0;const controller=createManualStatusController({uuid:()=> 'event',requestJson:async(url,options)=>{if(!options)return statusResult(task.id,reads++,reads===1?null:'completed');posts++;const e=Error('version_conflict');e.status=409;throw e;}});await controller.open(task);controller.choose(task.id,'running');await controller.save(task);assert.equal(posts,1);assert.equal(controller.get(task.id).loaded,false);await controller.save(task);assert.equal(posts,1);await controller.open(task,true);assert.equal(controller.get(task.id).draft,'completed');assert.equal(posts,1);});
test('locked execution control only allows an equivalent stopped status in the editor',async()=>{const task=input().tasks[0];task.state='paused';const controller=createManualStatusController({requestJson:async()=>statusResult(task.id,2,'running',{executionControl:{state:'paused',version:3}})});await controller.open(task);assert.equal(controller.get(task.id).draft,'paused');controller.choose(task.id,'running');assert.equal(controller.get(task.id).draft,'paused');const root=setup();renderManualStatusForm(root,task,controller);const options=walk(root).filter(n=>n.tagName==='OPTION'&&n.value);assert(options.filter(n=>!['paused','canceled'].includes(n.value)).every(n=>n.disabled));assert.equal(options.find(n=>n.value==='canceled').disabled,false);assert.match(root.textContent,/恢复请在对话中确认/);});
test('a presentation callback error cannot relabel a verified saved status as an uncertain write',async()=>{const task=input().tasks[0];const controller=createManualStatusController({uuid:()=> 'event',onSaved:()=>{throw Error('render failed');},requestJson:async(url,options)=>options?statusResult(task.id,1,'completed'):statusResult(task.id,0,null)});await controller.open(task);controller.choose(task.id,'completed');await controller.save(task);assert.equal(controller.get(task.id).submission,null);assert.match(controller.get(task.id).message,/已保存/);});

test('idempotent replay adopts a later server status instead of endlessly replaying an older choice',async()=>{const task=input().tasks[0];const controller=createManualStatusController({uuid:()=> 'event',requestJson:async(url,options)=>options?{...statusResult(task.id,3,'blocked'),duplicate:true}:statusResult(task.id,1,'running')});await controller.open(task);controller.choose(task.id,'completed');await controller.save(task);assert.equal(controller.get(task.id).submission,null);assert.equal(controller.get(task.id).data.state,'blocked');assert.match(controller.get(task.id).message,/当前状态已更新为受阻/);});

test('manual pause uses pause wording even before the source control projection refreshes',()=>{const b=input();b.tasks[0].manualStatus={state:'paused',version:1,source:'owner_manual'};assert.equal(taskClarity(b.tasks[0],b,null,now).next,'保持暂停，等待你的新指令');assert.equal(b.tasks[0].state,'partial');});
test('manual save hover retains a dark background and next-step labels stay unbroken',async()=>{const css=await readFile(new URL('../public/project-clarity.css',import.meta.url),'utf8');assert.match(css,/\.pc-save-status:hover\{background:#3d5745;color:#fff\}/);assert.match(css,/\.pc-next h3\{white-space:nowrap\}/);});

test('quick status reads current version then saves once without a second save click',async()=>{
 const task=input().tasks[0],calls=[],saved=[];
 const controller=createManualStatusController({uuid:()=> 'quick-event',onSaved:(id,result)=>saved.push([id,result.state]),requestJson:async(url,options)=>{calls.push([url,options]);return options?statusResult(task.id,5,'running'):statusResult(task.id,4,'blocked',{reason:'Keep the owner note'});}});
 await controller.quickSave(task,'running');assert.equal(calls.length,2);assert.equal(calls[0][1],undefined);
 assert.deepEqual(JSON.parse(calls[1][1].body),{expectedVersion:4,eventId:'quick-event',state:'running',reason:'Keep the owner note'});
 assert.deepEqual(saved,[[task.id,'running']]);assert.equal(task.state,'partial');
 assert(calls.every(([url])=>url==='/api/tasks/a/status'));
});
test('quick status loading rejects a second in-flight choice and never writes before a successful read',async()=>{
 const task=input().tasks[0];let resolveRead,posts=0;
 const controller=createManualStatusController({uuid:()=> 'quick-event',requestJson:async(url,options)=>{if(options){posts++;return statusResult(task.id,1,'completed');}return new Promise(resolve=>resolveRead=resolve);}});
 const first=controller.quickSave(task,'completed');await controller.quickSave(task,'running');assert.equal(posts,0);resolveRead(statusResult(task.id,0,null));await first;assert.equal(posts,1);assert.equal(controller.get(task.id).data.state,'completed');
 const failed=createManualStatusController({requestJson:async()=>{throw Error('offline');}});await failed.quickSave(task,'completed');assert.equal(failed.get(task.id).loaded,false);assert.match(failed.get(task.id).error,/读取/);
});
test('quick status preserves locked controls and never sends a prohibited change',async()=>{
 const task=input().tasks[0];for(const locked of ['paused','canceled']){let writes=0;const controller=createManualStatusController({requestJson:async(url,options)=>{if(options)writes++;return statusResult(task.id,2,locked,{executionControl:{state:locked,version:3}});}});await controller.quickSave(task,'running');assert.equal(writes,0);assert.match(controller.get(task.id).error,/恢复执行需要在对话中确认/);}
});
test('quick status conflict and uncertain writes do not announce success or replace the confirmed badge',async()=>{
 const task=input().tasks[0],saved=[];let postBodies=[];
 const controller=createManualStatusController({uuid:()=> 'quick-same',onSaved:()=>saved.push(true),requestJson:async(url,options)=>{if(!options)return statusResult(task.id,3,'blocked');postBodies.push(options.body);throw Error('network');}});
 await controller.quickSave(task,'completed');assert.equal(saved.length,0);assert.equal(controller.get(task.id).data.state,'blocked');await controller.save(task);assert.equal(postBodies[0],postBodies[1]);
 const conflict=createManualStatusController({uuid:()=> 'quick-conflict',onSaved:()=>saved.push(true),requestJson:async(url,options)=>{if(!options)return statusResult(task.id,3,'blocked');const error=Error('manual_status_version_conflict');error.status=409;throw error;}});await conflict.quickSave(task,'completed');assert.equal(conflict.get(task.id).loaded,false);assert.match(conflict.get(task.id).error,/重新读取/);assert.equal(saved.length,0);
});
test('state badge is the direct native dropdown while note editing is absent from the card',()=>{
 const root=setup(),task=input().tasks[0],picked=[];
 const controller={get:()=>({loading:false,saving:false,data:null,error:'',message:'',submission:null}),quickSave:(task,value)=>picked.push([task.id,value])};
 renderProjectClarity(root,input(),null,{now,statusController:controller});const select=nodes(root,'pc-status-select')[0];
 assert.equal(select.tagName,'SELECT');assert.match(select.getAttribute('aria-label'),/Verify application.*选择后自动保存/);assert.equal(select.children[0].textContent,'部分完成');assert.equal(select.children.length,7);assert.equal(nodes(root,'pc-status-editor').length,0);
 select.value='completed';select.fire('change');assert.deepEqual(picked,[['a','completed']]);assert.equal(task.state,'partial');
});
test('manual source remains visible on quick badges, and other tasks stay editable while one saves',()=>{
 const b=input();b.tasks[0].manualStatus={state:'completed',version:2,source:'owner_manual'};b.tasks.push({...b.tasks[0],id:'b',title:'Other task',manualStatus:null});
 const root=setup(),controller={get:id=>({loading:false,saving:id==='a',data:null,error:'',message:'',submission:null}),quickSave(){}};
 renderProjectClarity(root,b,null,{now,statusController:controller});const selects=nodes(root,'pc-status-select');assert.match(selects[0].children[0].textContent,/手动标记/);assert.equal(selects[0].disabled,true);assert.equal(selects[1].disabled,false);
});
test('header, search and request composer shortcuts stay within the existing UI and services',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),css=await readFile(new URL('../public/board-brand.css',import.meta.url),'utf8');
 const header=html.slice(html.indexOf('<section class="page-heading"'),html.indexOf('<div id="request-anchor"'));
 assert(html.slice(html.indexOf('<header class="topbar"'),html.indexOf('<div class="app-layout"')).includes('board-team.png'));assert(header.includes('heading-actions'));assert(!html.includes('<details class="search-panel">'));assert(html.includes('id="clear-search"'));
 assert(app.includes("$('request-anchor').append(panel)"));assert(app.includes("$('request-home').append(panel)"));assert(app.includes("requestProject()?.id&&!$('request-body').disabled?$('request-body'):$('request-project')"));
 assert.match(css,/\.page-heading h1\{font-size:34px/);assert.match(css,/\.search-inline input\{[^}]*height:44px/);
});
test('quick-save rerender restores the status focus without stealing focus from another control',async()=>{
 for(const userMoved of [false,true]){
  const root=setup(),doc=root.ownerDocument;doc.body={};let resolveSave;
  const controller={get:()=>({loading:false,saving:false,data:null,error:'',message:'',submission:null}),quickSave:()=>new Promise(resolve=>resolveSave=resolve)};
  root.querySelectorAll=()=>walk(root);renderProjectClarity(root,input(),null,{now,statusController:controller});const old=nodes(root,'pc-status-select')[0];doc.activeElement=old;old.value='completed';old.fire('change');
  renderProjectClarity(root,input(),null,{now,statusController:controller});const replacement=nodes(root,'pc-status-select')[0];replacement.focus=()=>doc.activeElement=replacement;const other={dataset:{focusKey:'other'}};doc.activeElement=userMoved?other:doc.body;resolveSave();await new Promise(resolve=>setImmediate(resolve));assert.equal(doc.activeElement,userMoved?other:replacement);
 }
});

test('manual completed renders old blocker and next step only under collapsed history',()=>{
 const b=input(),task=b.tasks[0];task.state='blocked';task.manualStatus={source:'owner_manual',state:'completed',version:1,reason:'Collection is finished; do not collect again.'};const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});
 assert.equal(nodes(root,'pc-blocker').length,0);assert.equal(nodes(root,'pc-history').length,1);const history=nodes(root,'pc-history')[0];assert.notEqual(history.open,true);assert.match(history.textContent,/原卡点/);assert(history.textContent.includes(task.nextAction));assert.equal(nodes(root,'pc-next')[0].textContent,'状态备注'+task.manualStatus.reason);assert.deepEqual(b,before);
});
test('inspector consumes the same current arrangement and history projection',async()=>{const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),inspector=source.slice(source.indexOf('function taskInspector'),source.indexOf('function taskInspector')+7000);assert.match(inspector,/clarity\.stopped\|\|clarity\.manualCompleted/);assert.match(inspector,/renderTaskHistory\(fragment,clarity\.history\)/);assert.doesNotMatch(inspector,/text\(task\.blocker\)|text\(task\.nextAction\)/);});

test('business counts exclude canceled history without private task-ID exceptions',()=>{
 const b=input();b.tasks.push({id:'old',project:'History',title:'Canceled history',state:'canceled'}, {id:'synthetic-secondary-task',project:'Environment check',title:'Auxiliary check',state:'blocked'});b.projects.push('History','Environment check');
 const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});
 assert.deepEqual(presentationScope(b),{registeredTasks:3,registeredProjects:4,businessTasks:2,businessProjects:2,historicalTasks:1,auxiliaryTasks:0});
 assert.equal(taskPresentationKind(b.tasks[2]),'business');assert.equal(projectPresentationKind(b,'History'),'history');assert.equal(projectPresentationKind(b,'Alpha'),'business');
 assert.equal(nodes(root,'pc-task').length,3);assert.match(root.textContent,/2 个有效业务项目 · 2 项业务任务/);assert.match(root.textContent,/历史记录/);assert.deepEqual(b,before);
});
test('manual completion and original pauses survive presentation classification',()=>{
 const b=input();b.tasks[0].manualStatus={state:'completed',version:1,source:'owner_manual'};b.tasks.push({id:'paused',title:'Paused',project:'Alpha',state:'paused'});
 const root=setup();renderProjectClarity(root,b,null,{now});assert.equal(presentationScope(b).businessTasks,2);assert.equal(taskClarity(b.tasks[0],b,null,now).status,'已完成');assert.equal(taskClarity(b.tasks[1],b,null,now).status,'已暂停');
});
test('missing and stale activity observations remain explicit rather than a zero-running assertion',()=>{
 const root=setup(),b=input();b.agents[0].activity.observedAt='2026-10-01T00:00:00Z';b.tasks[0].observedAt='2026-10-01T00:00:00Z';renderProjectClarity(root,b,null,{now});
 assert.match(root.textContent,/Agent 活动观察已过期/);assert.match(root.textContent,/Agent 当前活动未核实/);assert.match(root.textContent,/观察已过期，当前进展待核实/);assert.doesNotMatch(root.textContent,/0 位正在执行|0 个正在执行/);
 assert.equal(ownerObservationLabel({},now),'Agent 当前活动未核实');b.tasks[0].observedAt=null;renderProjectClarity(root,b,null,{now});assert.match(root.textContent,/观察时间未记录/);
 b.tasks[0].manualStatus={state:'completed',version:1,source:'owner_manual'};renderProjectClarity(root,b,null,{now});assert.match(root.textContent,/手动完成决定保持/);assert.equal(taskClarity(b.tasks[0],b,null,now).displayState,'completed');
});
test('registered wording never claims that every imported task was verified',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(app,/项已核对任务/);assert.match(app,/项登记任务/);assert.match(html,/已登记项目与任务/);assert.match(app,/本页队列不会自行执行/);assert.match(app,/另行配置并授权的 dot 检查沿原任务推进/);assert.match(app,/本地自动派发仍待验收/);assert.doesNotMatch(app,/自动唤醒与续跑尚未接通/);
});


test('default business projection archives cancellations and retains other task identities',()=>{
 const b=input();b.tasks.push({id:'old',project:'History',title:'Canceled history',state:'canceled'}, {id:'synthetic-secondary-task',project:'Environment check',title:'Auxiliary check',state:'blocked'});b.projects.push('History','Environment check');const before=structuredClone(b);
 const current=presentationBoard(b),archive=presentationBoard(b,true);assert.deepEqual(current.tasks.map(t=>t.id),['a','synthetic-secondary-task']);assert.deepEqual(current.projects,['Alpha','Environment check']);assert.deepEqual(archive.tasks.map(t=>t.id),['old']);assert.equal(archive.tasks[0],b.tasks[1]);assert.deepEqual(b,before);
 const root=setup();renderProjectClarity(root,current,null,{now,recordScope:'business'});assert.doesNotMatch(root.textContent,/Canceled history/);assert.match(root.textContent,/Auxiliary check/);assert.equal(nodes(root,'pc-task').length,2);
 renderProjectClarity(root,archive,null,{now,recordScope:'archive'});assert.equal(nodes(root,'pc-task').length,1);assert.match(root.textContent,/归档历史 · 1 项记录/);
});
test('business and archive switch is local presentation only and starts in business scope',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(app,/recordScope:'business'/);assert.match(html,/id="record-scope" class="record-scope-select"/);assert.doesNotMatch(html,/id="record-scope" class="mobile-project"/);assert.match(app,/const extra=visibleBoard\(\)/);assert.match(app,/clarityBoard\(visibleBoard\(\)\)/);
});

test('empty inbox discloses its narrow lifecycle scope without completing projects',()=>{
 const root=setup(),value={requests:[],unreadCount:0,pendingCount:0},before=structuredClone(value);
 renderRequestInbox(root,value);
 assert.match(root.textContent,/不含已分派、处理中、受阻记录/);
 assert.match(root.textContent,/收件箱为空不代表项目全部完成/);
 assert.match(nodes(root,'inbox-empty')[0].textContent,/当前收件范围/);
 assert.match(nodes(root,'inbox-empty')[0].textContent,/项目和执行队列/);
 assert.deepEqual(value,before);
 assert.equal(nodes(root,'inbox-open').length,0);
});


test('stale synthetic import preserves the original version and totals under an explicit historical source label',()=>{
 const b=input(),task=b.tasks[0];Object.assign(task,{id:'synthetic-history-task',project:'Synthetic board',observedAt:'2026-10-08T04:54:05Z',observation:'示例旧版 v2 导入记录：4项目、6任务、3名负责人。',assignedAgentIds:[]});b.projects=[task.project];b.agents=[];
 const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});const progress=nodes(root,'pc-progress')[0];
 assert.equal(progress.children[0].textContent,'历史导入记录');assert.match(progress.textContent,/不代表当前部署统计/);assert.match(progress.textContent,/也不是自动接续验收结果/);
 assert.equal(nodes(progress,'pc-copy')[0].textContent,task.observation);assert.match(progress.textContent,/v2.*4项目、6任务、3名/);assert.doesNotMatch(progress.textContent,/最新进展|当前版本 v99/);
 assert.equal(nodes(root,'pc-status')[0].textContent,'部分完成');assert.equal(nodes(root,'pc-task')[0].dataset.taskId,'synthetic-history-task');assert.deepEqual(b,before);
});

test('historical source label applies to stale evidence across project identities and preserves manual decisions',()=>{
 for(const variant of ['fresh-dot','unknown-dot','future-dot','other-project','manual-completed','paused']){
  const b=input(),task=b.tasks[0];task.id='synthetic-history-task';task.observedAt='2026-10-08T04:54:05Z';
  if(variant==='fresh-dot')task.observedAt='2026-10-08T10:59:00Z';if(variant==='unknown-dot')task.observedAt=null;if(variant==='future-dot')task.observedAt='2026-10-08T14:00:00Z';if(variant==='other-project')task.id='synthetic-other-task';
  if(variant==='manual-completed')task.manualStatus={source:'owner_manual',state:'completed',version:1,reason:'Owner completed this bounded step.'};if(variant==='paused')task.state='paused';
  const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});const historical=['other-project','manual-completed','paused'].includes(variant);
  assert.equal(nodes(root,'pc-progress')[0].children[0].textContent,historical?'历史导入记录':'最新进展');
  if(variant==='manual-completed')assert.equal(nodes(root,'pc-status')[0].textContent,'已完成手动');if(variant==='paused')assert.equal(nodes(root,'pc-status')[0].textContent,'已暂停');assert.deepEqual(b,before);
 }
});

test('existing task demand remains visible separately from an empty intake',()=>{
 const b=input();b.tasks[0].goal='Preserve the original application workflow';b.tasks[0].acceptanceCriteria='Read back the actual result';const before=structuredClone(b),root=setup();let selected;
 renderProjectClarity(root,b,null,{now,onTask:id=>selected=id});const demand=nodes(root,'pc-demand')[0];
 assert.equal(demand.dataset.sourceKind,'task-record');assert.match(demand.textContent,/既有任务需求/);assert(demand.textContent.includes(b.tasks[0].goal));assert(demand.textContent.includes(b.tasks[0].acceptanceCriteria));assert(root.textContent.includes(b.tasks[0].nextAction));
 nodes(root,'pc-task-title')[0].click();assert.equal(selected,b.tasks[0].id);assert.deepEqual(b,before);
 const inbox=setup();renderRequestInbox(inbox,{requests:[],pendingCount:0,unreadCount:0});assert.match(inbox.textContent,/既有任务的目标、完成标准与下一步/);assert.match(inbox.textContent,/无需在这里重复提交/);
});
test('missing task demand fields remain explicitly unrecorded without inventing goals',()=>{
 const b=input(),before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});const demand=nodes(root,'pc-demand')[0];assert.match(demand.textContent,/目标：尚未记录/);assert.match(demand.textContent,/完成标准：尚未记录/);assert(!demand.textContent.includes(b.tasks[0].observation));assert.deepEqual(b,before);
});
test('existing demand display preserves stopped decisions and never restores an old next step',()=>{
 for(const state of ['paused','canceled']){const b=input();b.tasks[0].state=state;b.tasks[0].goal='Historical requested outcome';b.tasks[0].nextAction='Resume and publish now';const before=structuredClone(b),root=setup();renderProjectClarity(root,b,null,{now});assert.match(nodes(root,'pc-demand')[0].textContent,/Historical requested outcome/);assert.doesNotMatch(root.textContent,/Resume and publish now/);assert.deepEqual(b,before);}
});
test('empty project intake describes only new feedback, not absence of existing task needs',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const root=setup(),byId=new Map(),get=id=>{if(!byId.has(id))byId.set(id,root.ownerDocument.createElement('section'));return byId.get(id);};
 const rendering=source.slice(source.indexOf('function renderRequestHistory(){'),source.indexOf('async function loadRequestDetail'));
 vm.runInNewContext(rendering+'\nrenderRequestHistory();',{$:get,requestProject:()=>({id:'existing-project'}),historyFor:()=>({loaded:true,requests:[],loading:false}),intake:{capabilities:{storageAvailable:true},details:new Map()},el:(tag,cls,text)=>{const node=root.ownerDocument.createElement(tag);node.className=cls;node.textContent=text;return node;}});
 assert.match(get('request-list').textContent,/暂无新增需求\/反馈记录/);assert.match(get('request-list').textContent,/已有目标、完成标准与下一步仍在项目任务中/);assert.match(html,/本项目新增需求 \/ 反馈记录/);assert.match(html,/已有任务需求在项目卡片中查看，无需重复填写/);
});

test('quick status distinguishes reading from saving without changing the task',()=>{
 for(const [loading,saving,label] of [[true,false,'读取中…'],[false,true,'保存中…'],[false,false,'部分完成']]){
  const root=setup(),board=input(),before=structuredClone(board);let writes=0;
  const controller={get:()=>({loading,saving,data:null,error:'',message:'',submission:null}),quickSave:()=>{writes++;}};
  renderProjectClarity(root,board,null,{now,statusController:controller});const select=nodes(root,'pc-status-select')[0];
  assert.equal(select.children[0].textContent,label);assert.equal(select.disabled,loading||saving);assert.equal(writes,0);assert.deepEqual(board,before);
 }
});
