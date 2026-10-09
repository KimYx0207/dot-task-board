import {renderProjectClarity, renderRequestInbox, taskClarity, clarityBoard, renderTaskHistory, createManualStatusController, renderManualStatusForm, MANUAL_STATES} from './project-clarity.js';
import {createQueueControls} from './queue-controls.js';
import {aggregateProjects, renderProjectOverview, ageExecutionBoard, executionExpirySignature, mappedQueueTaskContext, originalQueueTaskContext, withoutManagedQueueTasks} from './project-overview.js';
import {createRolePortrait, resolvePortraitRole} from './collaboration-graph.js';
'use strict';
const $ = id => document.getElementById(id);
const ui = {view:'projects', project:'', filter:'all', query:'', selected:null, fromAgent:null, detailOpen:false, contentType:'all'};
let config = null, board = null, requestId = 0, observationSignature = '', queueSnapshot = null, queueContextReadSignature = '', queueContextReadAt = 0;
const expandedDetails = new Set();
const manualStatuses=createManualStatusController({requestJson,supported:()=>config?.manualStatusEnabled===true,onChange:()=>{if(board)preserveFocus(()=>{renderCollaboration();if(ui.detailOpen)renderInspector();});},onSaved:(taskId,result)=>{board={...board,tasks:list(board.tasks).map(task=>task.id===taskId?{...task,manualStatus:{version:result.version,state:result.state,updatedAt:result.updatedAt,source:'owner_manual',reason:result.reason}}:task)};render();void refresh();}});
const dateFormat = new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'});
const AGENT_STATES = {running:{label:'工作中',tone:'blue'},waiting:{label:'等待中',tone:'amber'},blocked:{label:'受阻',tone:'red'},paused:{label:'已暂停',tone:'slate'},idle:{label:'空闲',tone:'slate'},completed:{label:'本轮完成',tone:'green'},unknown:{label:'状态未知',tone:'slate'}};
const ROLE_NAMES = {coordinator:'总体协调',owner:'项目负责人',worker:'执行',reviewer:'复核',researcher:'研究'};
const AGENT_FILTERS = [['all','全部'],['active','确认执行'],['attention','确认等待'],['completed','已完成'],['resting','空闲 / 暂停'],['unknown','待核实']];
const list = value => Array.isArray(value) ? value : [];
let evidenceBoardCache=null,evidenceBoardSource=null,evidenceBoardSignature='';
function currentBoard(){const signature=executionExpirySignature(board);if(evidenceBoardSource!==board||evidenceBoardSignature!==signature){evidenceBoardSource=board;evidenceBoardSignature=signature;evidenceBoardCache=ageExecutionBoard(board);}return evidenceBoardCache;}
const agents = () => list(currentBoard()?.agents);
const tasks = () => list(currentBoard()?.tasks);
const agentById = id => agents().find(agent => agent.id === id);
const taskById = id => tasks().find(task => task.id === id);
const isRoot = agent => agent.kind === 'coordinator' && agent.type !== 'subagent';
const text = (value, fallback = '') => typeof value === 'string' && !/(?:__external_|\/workspace\/|\/user_notes\/|\/agent_notes\/|\/root\/|dream_notes|system\s*prompt)/i.test(value) ? value : fallback;
function el(tag, className, value){const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=text(String(value));return node;}
function button(className, label, action){const node=el('button',className,label);node.type='button';if(action)node.addEventListener('click',action);return node;}
function formatted(value){const date = new Date(value);return value && Number.isFinite(date.getTime()) ? dateFormat.format(date)+' UTC' : '时间未记录';}
function freshness(value){if(!value || !Number.isFinite(Date.parse(value)))return 'unknown';const age=Date.now()-Date.parse(value);return age < -300000 ? 'clock_error' : age > (config?.staleAfterMinutes || 120)*60000 ? 'stale' : 'current';}
function activity(agent){return agent.activity || {state:'unknown'};}
function freshLabel(value){const state=freshness(value);return state==='stale'?'观察已过期':state==='clock_error'?'观察时钟异常':state==='unknown'?'时间待核实':'';}
function agentState(agent){const key=activity(agent).state;const configured=board?.presentation?.agentStates || config?.agentStates || AGENT_STATES;const value=configured[key] || AGENT_STATES[key] || AGENT_STATES.unknown;return key==='running'&&(activity(agent).effectiveState!=='running'||freshness(activity(agent).observedAt)!=='current')?{label:'当前执行未核实',tone:'slate'}:value;}
function taskState(task){const c=taskClarity(task,currentBoard(),queueSnapshot,Date.now(),config?.staleAfterMinutes||120);return {label:c.status+(c.manual?' · 手动':''),tone:c.stopped?'slate':c.executionState==='running'?'blue':c.displayState==='blocked'?'amber':['partial','completed'].includes(c.displayState)?'green':'slate'};}
function badge(value){const tone=['blue','amber','red','green','slate'].includes(value?.tone)?value.tone:'slate';return el('span',`badge ${tone}`,value?.label || '待核实');}
function agentName(agent){return text(agent?.name,'未命名 Agent') || '未命名 Agent';}
function agentTasks(agent){const ids=new Set(list(agent.taskIds));return tasks().filter(task=>ids.has(task.id) || list(task.assignedAgentIds).includes(agent.id));}
function taskAgents(task){return agents().filter(agent=>list(task.assignedAgentIds).includes(agent.id) || list(agent.taskIds).includes(task.id));}
function parentLabel(agent){if(isRoot(agent))return '主 Agent';const parent=agent.relationshipState==='known' ? agentById(agent.parentAgentId) : null;return parent ? `由 ${agentName(parent)} 创建` : '父级关系未核实';}
function inProjectAgent(agent){return !ui.project || list(agent.projectNames).includes(ui.project) || agentTasks(agent).some(task=>task.project===ui.project);}
function inProjectTask(task){return !ui.project || task.project===ui.project;}
function matchesQuery(values){return !ui.query || values.map(value=>text(value)).join(' ').toLocaleLowerCase().includes(ui.query);}
function agentMatches(agent){return inProjectAgent(agent) && matchesQuery([agent.name,agent.role,agent.responsibility,...list(agent.projectNames),activity(agent).summary,activity(agent).blocker,...agentTasks(agent).map(task=>task.title)]);}
function taskMatches(task){return inProjectTask(task) && matchesQuery([task.title,task.project,task.ownerRole,task.stage,task.observation,task.nextAction,task.blocker,...taskAgents(task).map(agent=>agent.name)]);}
function matchesAgentFilter(agent, filter=ui.filter){const state=activity(agent).state;switch(filter){case 'active':return !isRoot(agent) && state==='running' && freshness(activity(agent).observedAt)==='current';case 'attention':return ['waiting','blocked'].includes(state) && freshness(activity(agent).observedAt)==='current';case 'completed':return state==='completed';case 'resting':return ['idle','paused'].includes(state);case 'unknown':return state==='unknown' || ['stale','unknown','clock_error'].includes(freshness(activity(agent).observedAt));default:return true;}}
function visibleItems(){return ui.view==='agents' ? agents().filter(agent=>agentMatches(agent)&&matchesAgentFilter(agent)) : tasks().filter(task=>taskMatches(task)&&(ui.filter==='all'||taskClarity(task,currentBoard(),queueSnapshot).displayState===ui.filter));}
function preserveFocus(render){const active=document.activeElement,key=active?.dataset?.focusKey;render();if(key){for(const node of document.querySelectorAll('[data-focus-key]'))if(node.dataset.focusKey===key){node.focus({preventScroll:true});break;}}}
function setView(view, filter='all'){ui.view='projects';ui.filter=filter;ui.selected=null;ui.fromAgent=null;render();}
function setProject(project){ui.project=project;ui.selected=null;ui.fromAgent=null;ui.detailOpen=false;syncIntakeProjectByName(project);render();window.scrollTo({top:0,behavior:'auto'});$('project-page-title').focus({preventScroll:true});}
function selectItem(type,id,fromAgent=null){
  ui.detailFocusKey=document.activeElement?.dataset?.focusKey || document.activeElement?.dataset?.queueFocus || ui.detailFocusKey;
  const reset=ui.view!=='projects'&&type==='agent'&&!visibleItems().some(item=>item.id===id);
  if(reset){ui.view='projects';ui.project='';ui.filter='all';ui.query='';$('search').value='';}
  ui.selected={type,id};ui.fromAgent=fromAgent;ui.detailOpen=true;
  if(reset)render();else preserveFocus(()=>{renderRows();renderInspector();});
  if(type==='task'&&taskById(id))void manualStatuses.open(taskById(id));
  if(window.matchMedia('(max-width: 1050px)').matches)$('inspector').scrollIntoView({block:'start',behavior:'auto'});$('inspector').focus({preventScroll:true});
}
function clearFilters(){ui.query='';ui.filter='all';ui.project='';$('search').value='';ui.selected=null;ui.detailOpen=false;syncIntakeProjectByName('');render();}
function renderSummary(){$('summary').hidden=true;}

function projectNames(){return [...new Set([...list(board?.projects).map(project=>typeof project==='string'?project:project?.name),...tasks().map(task=>task.project),...agents().flatMap(agent=>list(agent.projectNames))].map(name=>text(name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function renderProjects(){
  const names=projectNames();if(ui.project && !names.includes(ui.project))ui.project='';
  $('project-total').textContent=names.length+'个';$('project-page-title').textContent=ui.project?ui.project+' · '+tasks().filter(t=>t.project===ui.project).length+'项任务':'项目工作台';$('workspace-caption').textContent=ui.project || '全部项目';$('project-context-label').textContent=ui.project || '全部项目';$('project-context-note').textContent='进展按来源记录显示；执行状态以最新回执为准。自动唤醒和自动续跑尚未接通。';
  const buttons=['',...names].map(name=>{const count=name?tasks().filter(task=>task.project===name).length:tasks().length;const node=button(`project-button${name?'':' all'}`,undefined,()=>setProject(name));node.dataset.focusKey=`project:${name}`;node.setAttribute('aria-pressed',String(name===ui.project));node.title=`${name || '全部项目'}${count===null?'':' · '+count+' 项已有任务'}`;node.append(el('span','project-dot'),el('span','project-button-title',name || '全部项目'),el('span','project-count',count===null?'':String(count)+'项'));return node;});
  $('projects').replaceChildren(...buttons);
  $('project').replaceChildren(...['',...names].map(name=>{const option=el('option','',name || '全部项目');option.value=name;return option;}));$('project').value=ui.project;
}
function renderFilters(){
 $('active-status-label').textContent=ui.filter==='all'?'全部':MANUAL_STATES[ui.filter]||config?.states?.[ui.filter]?.label||'待核实';
 const model=aggregateProjects(clarityBoard(observationBoard()),{project:ui.project,query:ui.query,staleAfterMinutes:config?.staleAfterMinutes}),base=model.projects.flatMap(p=>p.tasks);
 const filters=[['all','全部状态',base.length],...Object.entries(config?.states||{}).map(([key,value])=>[key,MANUAL_STATES[key]||value.label,base.filter(task=>task.state===key).length]).filter(([, , count])=>count>0)];
 $('filters').replaceChildren(...filters.map(([key,label,count])=>{const node=button('filter',undefined,()=>{ui.filter=key;ui.selected=null;render();});node.dataset.focusKey=`filter:${key}`;node.setAttribute('aria-pressed',String(ui.filter===key));node.append(document.createTextNode(label),el('span','filter-count',String(count)));return node;}));
}

function avatar(agent){return createRolePortrait(document,agent,'agent-avatar role-portrait');}
function agentRow(agent){
  const row=button('agent-row',undefined,()=>selectItem('agent',agent.id));row.dataset.focusKey=`agent:${agent.id}`;row.dataset.agentId=agent.id;row.setAttribute('aria-pressed',String(ui.selected?.type==='agent'&&ui.selected.id===agent.id));row.setAttribute('aria-label',`${agentName(agent)}，${agentState(agent).label}，查看详情`);
  const main=el('div','row-main'),title=el('div','row-title-line');title.append(el('span','row-name',agentName(agent)),el('span','type-tag',isRoot(agent)?'主 Agent':agent.type==='subagent'?'subagent':'Agent'));main.append(title,el('p','row-role',agent.role || ROLE_NAMES[agent.kind] || '职责未记录'));
  main.append(el('p','row-summary',activity(agent).summary || agent.responsibility || '工作内容尚未记录'));
  const meta=el('div','row-meta');if(!isRoot(agent))meta.append(el('span',agent.relationshipState==='known'?'relation-label':'',parentLabel(agent)));meta.append(el('span','',`${formatted(activity(agent).observedAt)} 观察`));main.append(meta);
  const end=el('div','row-end');end.append(badge(agentState(agent)));const label=freshLabel(activity(agent).observedAt);if(label)end.append(el('span','freshness-label',label));end.append(el('span','row-chevron','›'));row.append(avatar(agent),main,end);return row;
}
function taskRow(task){
  const row=button('task-row',undefined,()=>selectItem('task',task.id));row.dataset.focusKey=`task:${task.id}`;row.dataset.taskId=task.id;row.setAttribute('aria-pressed',String(ui.selected?.type==='task'&&ui.selected.id===task.id));
  const main=el('div','row-main');main.append(el('div','row-name',task.title),el('p','row-summary',taskClarity(task,currentBoard(),queueSnapshot).manualCompleted?taskClarity(task,currentBoard(),queueSnapshot).next:task.blocker || task.observation || task.nextAction || '进展尚未记录'));
  const linked=taskAgents(task),meta=el('div','row-meta');meta.append(el('span','',linked.length?linked.map(agentName).join('、'):'Agent 尚未关联'),el('span','',formatted(task.observedAt)));main.append(meta);
  const end=el('div','row-end');end.append(badge(taskState(task)));const label=freshLabel(task.observedAt);if(label)end.append(el('span','freshness-label',label));row.append(el('span',`task-status-mark ${taskState(task).tone}`),main,end);return row;
}
function groupSection(name, items, renderer, className=''){const section=el('section',`agent-group ${className}`),head=el('div','group-heading');head.append(el('h3','group-title',name),el('span','group-count',`${items.length} ${ui.view==='agents'?'位':'项'}`));const rows=el('div','group-list');rows.append(...items.map(renderer));section.append(head,rows);return section;}
function emptyState(title,hint,action){const node=el('div','empty');node.append(el('h2','',title),el('p','',hint));if(action)node.append(button('',action.label,action.run));return node;}
function ensureSelection(rows){if(ui.fromAgent && ui.selected?.type==='task' && taskById(ui.selected.id) && agentById(ui.fromAgent) && agentTasks(agentById(ui.fromAgent)).some(task=>task.id===ui.selected.id))return;const type=ui.view==='agents'?'agent':'task';if(ui.selected?.type===type && rows.some(row=>row.id===ui.selected.id))return;const first=ui.view==='agents' ? rows.find(agent=>matchesAgentFilter(agent,'active')) || rows[0] : rows[0];ui.selected=first?{type,id:first.id}:null;ui.fromAgent=null;}
function renderRows(){$('result-count').textContent=`${aggregateProjects(clarityBoard(board),{project:ui.project,query:ui.query,taskState:ui.filter}).projects.length} 个选定项目`;$('rows').hidden=true;}

function detailSection(title,icon,value,missing='暂无记录'){const node=el('section','detail-section'),head=el('h3','');head.append(el('span','section-icon',icon),document.createTextNode(title));node.append(head);if(value!==undefined)node.append(el('p',value?'':'missing',value || missing));return node;}
function appendPairs(parent,pairs){const dl=el('dl','detail-pairs');for(const [key,value] of pairs)dl.append(el('dt','',key),el('dd','',value || '未记录'));parent.append(dl);}
function appendEvidence(parent,items){const links=el('div','evidence-links');for(const item of list(items)){try{const url=new URL(item.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;const link=el('a','',item.label || '查看结果');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';links.append(link);}catch{}}
  if(links.childElementCount)parent.append(links);else parent.append(el('p','missing','尚未附可打开的产出链接'));
}
function inspectorTop(type){const top=el('div','inspector-topline');top.append(el('span','',type==='agent'?'负责人来源':'任务详情'));const back=button('inspector-back mobile-back','返回列表',closeInspector);top.append(back,button('inspector-close','关闭',closeInspector));return top;}
function agentInspector(agent){
  const fragment=document.createDocumentFragment();fragment.append(inspectorTop('agent'));
  const identity=el('div','inspector-identity'),title=el('div','');title.append(el('h2','',agentName(agent)),el('p','',`${isRoot(agent)?'主 Agent':'subagent'} · ${agent.role || ROLE_NAMES[agent.kind] || '职责未记录'}`));identity.append(avatar(agent),title);fragment.append(identity);fragment.append(el('p','time-note',resolvePortraitRole(agent).note));
  const status=el('div','inspector-status');status.append(badge(agentState(agent)),el('span','',freshLabel(activity(agent).observedAt) || '近期观察'));fragment.append(status);
  if(agent.responsibility)fragment.append(el('p','inspector-description',agent.responsibility));
  const doing=detailSection('正在做什么','◉',activity(agent).summary,'尚未记录当前工作');doing.append(el('p','time-note',`观察于 ${formatted(activity(agent).observedAt)} · 此记录不是实时心跳`));fragment.append(doing);
  const waiting=detailSection('等待与下一步','⌁');if(activity(agent).blocker){const block=el('div','attention-box');block.append(el('strong','',['waiting','blocked'].includes(activity(agent).state)?'停在这里的原因':'已记录的限制'),document.createTextNode(text(activity(agent).blocker)));waiting.append(block);}else waiting.append(el('p','missing',['waiting','blocked'].includes(activity(agent).state)?'当前为等待 / 受阻状态，具体原因尚未记录':'这次观察没有记录阻塞原因'));
  if(activity(agent).nextAction){const next=el('div','next-action');next.append(el('strong','','下一步'),document.createTextNode(text(activity(agent).nextAction)));waiting.append(next);}fragment.append(waiting);
  const result=detailSection('最近产出','↗',agent.latestResult?.summary,'尚未收到本轮产出记录');if(agent.latestResult){if(agent.latestResult.observedAt)result.append(el('p','time-note',formatted(agent.latestResult.observedAt)));appendEvidence(result,agent.latestResult.evidence);}fragment.append(result);
  const related=agentTasks(agent),taskSection=detailSection(`承接的任务 · ${related.length}`,'▤');
  if(related.length){const rows=el('div','related-list');for(const task of related){const node=button('related-button',undefined,()=>selectItem('task',task.id,agent.id));node.append(el('span','',task.title),badge(taskState(task)));rows.append(node);}taskSection.append(rows);}else taskSection.append(el('p','missing','尚未关联任务条目，不代表没有在工作'));
  if(agent.unresolvedTaskCount)taskSection.append(el('p','time-note',`${agent.unresolvedTaskCount} 项关联任务不在这次导入范围内`));fragment.append(taskSection);
  const children=agents().filter(child=>child.relationshipState==='known'&&child.parentAgentId===agent.id);
  const relation=detailSection('协作关系','⑂');appendPairs(relation,[['类型',isRoot(agent)?'主 Agent':agent.type==='subagent'?'子 Agent（subagent）':'Agent'],['创建关系',parentLabel(agent)],['项目归属',list(agent.projectNames).join('、') || '未分配']]);
  if(children.length){const rows=el('div','related-list');for(const child of children){const node=button('related-button',undefined,()=>selectItem('agent',child.id));node.append(el('span','',agentName(child)),badge(agentState(child)));rows.append(node);}relation.append(el('p','time-note',`${children.length} 个已记录的直接 subagent`),rows);}relation.append(el('p','time-note','项目归属用于分类，不代表 Agent 的上下级关系'));fragment.append(relation);
  const source=detailSection('记录来源','◷');appendPairs(source,[['来源',agent.source?.label || '来源未记录'],['记录时间',formatted(agent.source?.observedAt)]]);fragment.append(source);return fragment;
}
function taskInspector(task){
  const fragment=document.createDocumentFragment();fragment.append(inspectorTop('task'));
  if(ui.fromAgent){const agent=agentById(ui.fromAgent);fragment.append(button('inspector-back',`← 返回 ${agentName(agent)}`,()=>selectItem('agent',ui.fromAgent)));}
  fragment.append(el('h2','inspector-title',`${task.taskNumber?'#'+task.taskNumber+' · ':''}${task.title}`));fragment.append(button('request-task-cta','就这项任务补充需求 / 反馈',()=>openTaskRequest(task)));const status=el('div','inspector-status');status.append(badge(taskState(task)),el('span','',freshLabel(task.observedAt) || '近期观察'));fragment.append(status);
  const progress=detailSection('进展记录','◉',task.currentStep?`当前步骤：${task.currentStep}`:task.lastEffectiveAction?`最近有效动作：${task.lastEffectiveAction}`:task.observation,'尚未记录具体进展');appendPairs(progress,[['项目',task.project],['阶段',task.stage],['任务角色',task.ownerRole || '角色未记录'],['观察时间',formatted(task.observedAt)]]);fragment.append(progress);
  const clarity=taskClarity(task,currentBoard(),queueSnapshot,Date.now(),config?.staleAfterMinutes||120),arranged=clarity.stopped||clarity.manualCompleted;const next=detailSection(arranged?'当前安排':'卡点与下一步','⌁');if(arranged){next.append(el('p','',clarity.next));}else {if(clarity.blocker){const block=el('div','attention-box');block.append(el('strong','','停在这里的原因'),document.createTextNode(text(clarity.blocker)));next.append(block);}const node=el('div','next-action');node.append(el('strong','','下一步'),document.createTextNode(text(clarity.next)));next.append(node);if(task.nextOwnerRole)next.append(el('p','time-note',`下一步负责人 · ${task.nextOwnerRole}`));}fragment.append(next);renderTaskHistory(fragment,clarity.history);
  const linked=taskAgents(task),owners=detailSection('执行负责人记录','⑂');if(linked.length){const rows=el('div','related-list');for(const agent of linked){const node=button('related-button',undefined,()=>selectItem('agent',agent.id));node.append(el('span','',agentName(agent)),badge(agentState(agent)));rows.append(node);}owners.append(rows);}else owners.append(el('p','missing','尚未找到可核对的原执行线程'));fragment.append(owners);
  const evidence=detailSection('产出与证据','↗');appendEvidence(evidence,task.evidence);fragment.append(evidence);
  const manualSection=detailSection('手动状态与备注','');renderManualStatusForm(manualSection,task,manualStatuses);fragment.append(manualSection);
  const checks=detailSection('验收状态','✓'),checksList=el('div','verification');for(const [key,label] of [['sourceReview','源码 / 资料检查'],['deployment','部署 / 交付'],['businessAcceptance','业务验收']]){const check=task.verification?.[key] || {},row=el('div','verification-row'),line=el('div','verification-top');line.append(el('span','',label),el('span','verification-state',config?.verification?.[check.state] || '未核实'));row.append(line);if(check.note)row.append(el('p','verification-note',check.note));checksList.append(row);}checks.append(checksList);fragment.append(checks);
  const details=el('details','more-details');details.open=expandedDetails.has(task.id);details.addEventListener('toggle',()=>{if(details.open)expandedDetails.add(task.id);else expandedDetails.delete(task.id);});details.append(el('summary','','目标与完成标准'));for(const [label,value] of [['目标',task.goal],['完成标准',task.acceptanceCriteria],['留给你的决定',task.retainedDecision]]){details.append(el('h3','',label),el('p','',value || '未记录'));}if(task.state==='paused')details.append(el('p','','保持暂停；此页面不会启动或恢复任务'));fragment.append(details);return fragment;
}
function renderInspector(){$('inspector').hidden=!ui.detailOpen;const selected=ui.selected&&(ui.selected.type==='agent'?agentById(ui.selected.id):taskById(ui.selected.id));if(!selected){ui.detailOpen=false;$('inspector').hidden=true;const empty=el('div','inspector-empty');empty.append(el('span','','↖'),el('h2','','选择一条记录'),el('p','','查看任务、等待原因和最近产出'));$('inspector').replaceChildren(empty);return;}$('inspector').replaceChildren(ui.selected.type==='agent'?agentInspector(selected):taskInspector(selected));}
function queueTaskContext(job){return mappedQueueTaskContext(currentBoard(),job)||originalQueueTaskContext(currentBoard(),job);}
// Private Site observations and legacy dispatch accounting are separate scopes.
function observationBoard(){return currentBoard();}
function refreshQueueContext(snapshot){
  if(!board||!snapshot?.enabled||$('refresh').disabled)return;
  const jobs=list(snapshot.jobs).filter(job=>job.state!=='canceled'),records=list(board?.queueUpdates?.records);
  if(!jobs.some(job=>!records.some(record=>record.id==='dispatch:'+job.id&&record.queueVersion===job.version)))return;
  const signature=JSON.stringify(jobs.map(job=>[job.id,job.version,job.threadBound]));
  if(signature===queueContextReadSignature||Date.now()-queueContextReadAt<10000)return;
  queueContextReadSignature=signature;queueContextReadAt=Date.now();
  void refresh().then(ok=>{if(ok===false)queueContextReadSignature='';});
}

function renderCollaboration(){
 $('rows').hidden=true;$('workspace').classList.add('canvas-view');const container=$('collaboration-map');container.hidden=false;
 const extra=observationBoard();$('observation-count').textContent=`${list(extra.tasks).length} 项已核对任务`;
 renderProjectClarity(container,extra,queueSnapshot,{project:ui.project,query:ui.query,taskState:ui.filter,contentType:ui.contentType,statusController:manualStatuses,staleAfterMinutes:config?.staleAfterMinutes||120,onClear:clearFilters,onProject:setProject,onTask:id=>selectItem('task',id),onAgent:id=>selectItem('agent',id)});
}

function render(){if(!board)return;$('clear-search').hidden=!ui.query;preserveFocus(()=>{renderProjects();renderSummary();renderFilters();renderRows();renderInspector();renderCollaboration();renderIntake();renderInbox();dispatchQueue.refreshView?.();});}
function renderSource(){const imported=formatted(board.importedAt);$('source-scope').textContent=board.statusUpdates?.taskCount?`${board.statusUpdates.taskCount} / ${tasks().length} 项局部更新`:'已导入部分记录';$('snapshot-mode').textContent=board.source?.mode==='synthetic'?'演示数据 · 非实时':'状态快照 · 非实时';$('source-meta').textContent=`导入于 ${imported} · 重读不会更新观察时间`;if(board.statusUpdates?.taskCount){$('source-meta').textContent+=` · ${board.statusUpdates.taskCount} / ${tasks().length} 项任务局部更新，最近证据 ${formatted(board.statusUpdates.latestObservedAt)}；未更新任务及 Agent 记录仍沿用原时间，Agent 数量不是运行数`;};if(board.queueUpdates?.totalQueueRecords||board.queueUpdates?.truncated){$('source-meta').textContent+=` · 队列共 ${board.queueUpdates.totalQueueRecords} 条记录，当前选入 ${board.queueUpdates.taskCount} 项，最近回执 ${formatted(board.queueUpdates.latestObservedAt)}${board.queueUpdates.truncated?'（当前仅展示部分队列）':''}；回执时间不代表持续在线`;};$('source-label').textContent=text(board.source?.label,'导入记录');$('coverage').textContent=`${agents().length} 位已知 Agent · ${tasks().length} 项选定任务 · ${text(board.coverage?.scope,'仅包含已导入的部分记录')}`;$('read-at').textContent=`本次读取 ${formatted(board.generatedAt)}（仅刷新页面，不更新来源记录）`;}
function showError(code){const message=code==='no_feed'?'尚未接入状态快照':/schema|invalid|missing/.test(code)?'快照格式暂不受支持':code==='auth'?'登录状态已失效，请重新打开私密看板登录':'暂时无法读取快照';$('notice').className='notice error';$('notice').textContent=board?`${message}。保留上次读取的内容，这些记录尚未更新。`:message;if(!board){$('rows').replaceChildren(emptyState(message,'可以稍后点击“重读快照”再试'));$('source-meta').textContent='没有可用的观察数据';}}
async function refresh(){
  const sequence=++requestId,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);$('refresh').disabled=true;$('refresh').textContent='读取中…';
  try{if(!config){const response=await fetch('/api/config',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error([401,403].includes(response.status)?'auth':'config_unavailable');config=await response.json();}
    const response=await fetch('/api/board',{cache:'no-store',signal:controller.signal});if([401,403].includes(response.status))throw new Error('auth');const result=await response.json();if(sequence!==requestId)return;if(!response.ok)throw new Error(result.error || 'source_unavailable');if(!Array.isArray(result.tasks))throw new Error('invalid_tasks');board=result;$('notice').textContent='';$('notice').className='notice';renderSource();render();observationSignature=freshnessSignature();refreshIntakeProjectIfNeeded();void loadInbox();return true;
  }catch(error){if(sequence===requestId)showError(error.message || 'source_unavailable');return false;}
  finally{clearTimeout(timer);if(sequence===requestId){$('refresh').disabled=false;$('refresh').replaceChildren(el('span','','↻'),document.createTextNode(' 更新进展'));}}
}
$('search').addEventListener('input',()=>{ui.query=$('search').value.trim().toLocaleLowerCase();ui.selected=null;ui.fromAgent=null;render();});
$('clear-search').addEventListener('click',()=>{ui.query='';$('search').value='';render();$('search').focus();});
$('project').addEventListener('change',()=>setProject($('project').value));$('refresh').addEventListener('click',refresh);
function freshnessSignature(){return [...agents().map(agent=>`${agent.id}:${freshness(activity(agent).observedAt)}`),...tasks().map(task=>`${task.id}:${freshness(task.observedAt)}`),executionExpirySignature(board)].join('|');}
function ageVisibleEvidence(){if(document.hidden)return;dispatchQueue.age();if(!board||document.querySelector('.po-viewport.is-dragging'))return;const next=freshnessSignature();if(next!==observationSignature){observationSignature=next;preserveFocus(()=>{renderFilters();renderRows();renderInspector();renderCollaboration();});}}
setInterval(ageVisibleEvidence,1000);
document.addEventListener('visibilitychange',ageVisibleEvidence);


// Intake drafts are local-only. Receipts and workflow statuses always come from the server.
const inbox = {value:null,loading:false,error:''};
function renderInbox(){if(!$('request-inbox'))return;preserveFocus(()=>renderRequestInbox($('request-inbox'),inbox.value,{loading:inbox.loading,error:inbox.error,onRetry:()=>void loadInbox(),onMore:()=>void loadInbox({more:true}),onOpen:openInboxRequest}));}
async function loadInbox({more=false}={}){
  if(inbox.loading||more&&!inbox.value?.nextCursor)return;const cursor=more?inbox.value.nextCursor:null;inbox.loading=true;renderInbox();
  try{const value=await requestJson('/api/intake/inbox'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(value.requests)||!Number.isSafeInteger(value.unreadCount)||!Number.isSafeInteger(value.pendingCount)||value.requests.some(item=>!item||typeof item.id!=='string'||typeof item.projectId!=='string'||typeof item.body!=='string'||!Object.hasOwn(REQUEST_STATUS,item.status)))throw Error('invalid_response');if(more){const merged=new Map(inbox.value.requests.map(item=>[item.id,item]));for(const item of value.requests){const previous=merged.get(item.id);if(!previous||!Number.isInteger(previous.version)||item.version>=previous.version)merged.set(item.id,item);}value.requests=[...merged.values()];}inbox.value=value;inbox.error='';}
  catch(error){inbox.error=error.message||'inbox_unavailable';}
  finally{inbox.loading=false;renderInbox();}
}
function openInboxRequest(receipt){
  const project=requestChoices().find(item=>item.id===receipt.projectId);
  if(!project){$('notice').textContent='这条需求的项目暂未载入，请更新进展后再打开。';return;}
  chooseIntakeProject(project.key);ui.detailOpen=false;$('inspector').hidden=true;showRequestPanel(false);
  void loadRequestDetail(receipt.id,receipt.projectId).then(()=>{if(requestProject()?.id!==receipt.projectId||intake.selectedReceipt!==receipt.id||!$('request-panel').open)return;$('request-detail').scrollIntoView({block:'start',behavior:'auto'});$('request-detail').focus({preventScroll:true});});
}

const INTAKE_STORAGE_KEY = 'dot-board-project-drafts-v1';
const REQUEST_STATUS = {received:'已保存，待 dot 读取',read:'dot 已读取',accepted:'已受理',needs_confirmation:'待你确认',declined:'未受理',assigned:'已分派',in_progress:'推进中',blocked:'受阻',completed:'已返回结果',canceled:'已取消'};
const intake = {capabilities:null,capabilityError:'',projectKey:'',drafts:Object.create(null),history:new Map(),submitting:new Set(),messages:new Map(),details:new Map(),selectedReceipt:null,storageWarning:false,capabilityLoading:false};
function requestPlain(tag,className,value){const node=el(tag,className);node.textContent=typeof value==='string'?value:'';return node;}
function requestChoices(){
  const grouped=new Map();
  for(const row of list(board?.projectSummaries).filter(row=>row&&typeof row.name==='string')){
    const key=row.id || `legacy:${row.name}`,existing=grouped.get(key);
    if(existing){existing.names=[...new Set([...existing.names,row.name])];if(row.canonicalName)existing.displayName=row.canonicalName;existing.taskIds=[...new Set([...existing.taskIds,...list(row.taskIds)])];}
    else grouped.set(key,{...row,key,displayName:row.canonicalName || row.name,names:[row.name],taskIds:list(row.taskIds)});
  }
  for(const name of projectNames())if(![...grouped.values()].some(row=>row.names.includes(name)))grouped.set(`legacy:${name}`,{id:null,name,displayName:name,names:[name],key:`legacy:${name}`,taskIds:[]});
  return [...grouped.values()];
}
function requestProject(){return requestChoices().find(row=>row.key===intake.projectKey) || null;}
function projectRequestTasks(project){return project?.id?tasks().filter(task=>task.projectId===project.id || list(project.taskIds).includes(task.id)):[];}
function blankDraft(){return {body:'',contextTaskId:null,context:null,pending:null};}
function currentDraft(key=intake.projectKey){if(!key)return blankDraft();if(!intake.drafts[key])intake.drafts[key]=blankDraft();return intake.drafts[key];}
function persistIntakeDrafts(){try{sessionStorage.setItem(INTAKE_STORAGE_KEY,JSON.stringify({projectKey:intake.projectKey,drafts:intake.drafts}));intake.storageWarning=false;}catch{intake.storageWarning=true;}}
function restoreIntakeDrafts(){try{const saved=JSON.parse(sessionStorage.getItem(INTAKE_STORAGE_KEY) || 'null');if(!saved || typeof saved!=='object')return;if(typeof saved.projectKey==='string')intake.projectKey=saved.projectKey;if(saved.drafts&&typeof saved.drafts==='object'&&!Array.isArray(saved.drafts)){for(const [key,value] of Object.entries(saved.drafts).slice(0,100)){if(!value||typeof value.body!=='string'||value.body.length>6000)continue;intake.drafts[key]={body:value.body,contextTaskId:typeof value.contextTaskId==='string'?value.contextTaskId:null,context:value.context&&typeof value.context==='object'?value.context:null,pending:value.pending&&typeof value.pending.payload==='object'?value.pending:null};}}}catch{intake.storageWarning=true;}}
function captureRequestContext(project,draft){const task=taskById(draft.contextTaskId);const summary=[`项目：${project?.displayName || project?.name || ''}`,task?`关联任务：${task.title}`:'项目整体需求',task?`任务观察：${task.observation || '未记录'}`:'',task?.observedAt?`观察时间：${task.observedAt}`:''].filter(Boolean).join('\n');return {viewedSnapshotRevision:board?.snapshotRevision || '',viewedSnapshotImportedAt:board?.importedAt || '',contextSummary:summary.slice(0,1500),taskTitle:task?.title || '',taskObservedAt:task?.observedAt || null};}
function requestStatus(status){return Object.hasOwn(REQUEST_STATUS,status)?REQUEST_STATUS[status]:'状态待核实';}
function receiptValid(receipt,projectId){return receipt && typeof receipt.id==='string' && receipt.projectId===projectId && typeof receipt.clientSubmissionId==='string' && Number.isInteger(receipt.version) && receipt.version>0 && Number.isFinite(Date.parse(receipt.createdAt)) && Object.hasOwn(REQUEST_STATUS,receipt.status);}
function receiptMatches(receipt,pending){const payload=pending?.payload;return payload && receipt.clientSubmissionId===payload.clientSubmissionId && receipt.body===payload.body.trim() && (receipt.contextTaskId || null)===(payload.contextTaskId || null) && receipt.viewedSnapshotRevision===payload.viewedSnapshotRevision;}
function historyFor(id){if(!intake.history.has(id))intake.history.set(id,{requests:[],nextCursor:null,loading:false,loaded:false,error:'',sequence:0});return intake.history.get(id);}
function mergeReceipts(history,receipts){const merged=new Map(history.requests.map(receipt=>[receipt.id,receipt]));for(const receipt of receipts){const existing=merged.get(receipt.id);if(!existing||receipt.version>=existing.version)merged.set(receipt.id,receipt);}history.requests=[...merged.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));}
function acceptReceipt(projectId,receipt){
  const draft=currentDraft(projectId);if(draft.pending&&!receiptMatches(receipt,draft.pending))return false;
  const history=historyFor(projectId);mergeReceipts(history,[receipt]);history.loaded=true;
  intake.messages.set(projectId,{tone:'success',text:`${requestStatus(receipt.status)}${receipt.status==='received'&&!intake.capabilities?.enabled?' · 通道验收中':''}。服务器回执 ${receipt.id} · ${formatted(receipt.createdAt)}`});
  if(draft.pending){intake.drafts[projectId]=blankDraft();persistIntakeDrafts();}return true;
}
function intakeErrorMessage(code,status){if(status===401||status===403)return '登录状态不可用，请重新打开私密看板登录；草稿已保留';const messages={intake_not_ready:'需求通道尚未启用，草稿已保留',body_too_long:'内容超过 6000 字，请缩短后提交',request_too_large:'内容过长，请缩短后提交',invalid_body:'请填写有效的需求内容',invalid_task_context:'关联任务无效，请重新选择；草稿已保留',task_project_mismatch:'关联任务不属于这个项目，请重新选择',unknown_project:'项目尚未接入需求通道',project_not_found:'项目尚未接入需求通道',idempotency_conflict:'提交标识与已保存内容冲突，请先核对需求记录；草稿已保留',submission_conflict:'提交标识与已保存内容冲突，请先核对需求记录；草稿已保留',invalid_snapshot_revision:'快照版本不可用，请更新看板后重新提交',invalid_snapshot_time:'快照时间不可用，请更新看板后重新提交'};return messages[code] || (status===409?'提交发生冲突，请先更新需求记录核对；草稿已保留':'暂时无法确认保存结果，草稿已保留。可重试同一条需求核对回执');}
async function requestJson(url,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{...options,cache:'no-store',credentials:'same-origin',signal:controller.signal});let result;try{result=await response.json();}catch{const error=new Error('invalid_response');error.uncertain=true;throw error;}if(!response.ok){const error=new Error(result?.error || 'request_failed');error.status=response.status;throw error;}return result;}finally{clearTimeout(timer);}}
async function loadIntakeCapabilities(){if(intake.capabilityLoading)return;intake.capabilityLoading=true;renderIntake();try{const value=await requestJson('/api/intake/capabilities');if(typeof value.enabled!=='boolean'||typeof value.canSubmit!=='boolean'||typeof value.storageAvailable!=='boolean')throw Error('invalid_response');intake.capabilities=value;intake.capabilityError='';}catch(error){intake.capabilityError=intakeErrorMessage(error.message,error.status);intake.capabilities=null;}finally{intake.capabilityLoading=false;renderIntake();const project=requestProject();if(project?.id&&intake.capabilities?.storageAvailable)void loadProjectRequests(project.id);}}
function refreshIntakeProjectIfNeeded(){const project=requestProject();if(project?.id&&intake.capabilities?.storageAvailable){const history=historyFor(project.id);if(!history.loaded&&!history.loading)void loadProjectRequests(project.id);}}
function chooseIntakeProject(key,{syncBoard=true,load=true}={}){intake.projectKey=key;intake.selectedReceipt=null;persistIntakeDrafts();const project=requestProject();if(syncBoard){ui.project=project?.name || '';ui.selected=null;ui.fromAgent=null;render();}else renderIntake();if(load&&project?.id&&intake.capabilities?.storageAvailable)void loadProjectRequests(project.id);}
function syncIntakeProjectByName(name){if(!name){chooseIntakeProject('',{syncBoard:false});return;}const current=requestProject();if(current?.names.includes(name))return;const matches=requestChoices().filter(row=>row.names.includes(name));chooseIntakeProject(matches.length===1?matches[0].key:'',{syncBoard:false});}
function openTaskRequest(task){const matches=requestChoices().filter(project=>project.id && (task.projectId===project.id || list(project.taskIds).includes(task.id)));const project=matches.length===1?matches[0]:requestChoices().find(project=>!project.id&&project.name===task.project);if(!project){intake.messages.set('',{tone:'error',text:'这项任务尚未绑定唯一的项目需求通道，请先选择项目'});chooseIntakeProject('');}else{chooseIntakeProject(project.key);const draft=currentDraft();if(draft.pending){intake.messages.set(project.key,{tone:'error',text:'此项目还有一条保存结果待核对的需求，请先重试确认回执，再修改关联任务'});}else{draft.contextTaskId=task.id;draft.context=captureRequestContext(project,draft);persistIntakeDrafts();}renderIntake();}showRequestPanel();}
function renderRequestContext(project,draft){const context=draft.pending?.payload || draft.context || captureRequestContext(project,draft);const task=taskById(draft.contextTaskId);const nodes=[el('p','',project?`所属项目：${project.displayName || project.name}`:'请先选择具体项目'),el('p','',draft.contextTaskId?`关联任务：${draft.context?.taskTitle || task?.title || draft.contextTaskId}`:'关联范围：项目整体')];if(context.viewedSnapshotRevision){const revision=el('p','',`引用快照：${context.viewedSnapshotRevision.slice(0,19)}… · 导入于 ${formatted(context.viewedSnapshotImportedAt)}`);revision.title=context.viewedSnapshotRevision;nodes.push(revision);}else nodes.push(el('p','','快照版本尚未读取，暂不能提交'));if(draft.context?.taskObservedAt || task?.observedAt)nodes.push(el('p','',`任务观察于 ${formatted(draft.context?.taskObservedAt || task?.observedAt)}`));if(context.viewedSnapshotRevision && board?.snapshotRevision!==context.viewedSnapshotRevision)nodes.push(el('p','context-stale',`当前看板已有新快照；本条需求仍引用你开始填写时的记录（${formatted(context.viewedSnapshotImportedAt)}）`));$('request-context').replaceChildren(...nodes);}
function renderIntake(){
  if(!$('request-workspace'))return;const choices=requestChoices();const currentValue=intake.projectKey;
  const options=[el('option','','选择一个具体项目')];options[0].value='';for(const project of choices){const duplicate=choices.filter(row=>row.name===project.name).length>1;const option=el('option','',`${project.displayName || project.name}${project.names.length>1?` · 含 ${project.names.length} 个项目名称`:''}${duplicate&&project.id?` · ${project.id}`:''}${project.id?'':' · 尚未接入'}`);option.value=project.key;options.push(option);}$('request-project').replaceChildren(...options);$('request-project').value=choices.some(project=>project.key===currentValue)?currentValue:'';
  const project=requestProject(),draft=currentDraft(),caps=intake.capabilities,enabled=Boolean(project?.id&&caps?.canSubmit&&caps.storageAvailable),pending=Boolean(draft.pending),submitting=Boolean(project?.id&&intake.submitting.has(project.id));
  let channel;if(intake.capabilityLoading)channel='正在检查需求通道…';else if(intake.capabilityError)channel='暂时无法核实需求通道。请更新需求记录后再试，未提交内容会保留。';else if(!caps?.storageAvailable)channel='需求存储尚未接通，当前不能提交。未提交的草稿不会显示为已保存。';else if(caps.registryStatus==='invalid')channel='项目需求标识配置暂不可用，当前不能提交。原有 Agent 和任务记录仍可查看。';else if(caps.registryAvailable===false)channel='项目需求标识尚未配置，当前不能提交。原有 Agent 和任务记录仍可查看。';else if(!caps.connectionVerified||!caps.bridgeEnabled)channel='dot 读取通道尚未接通，当前不能提交。保存与 dot 已读会分别记录。';else if(!caps.canSubmit)channel='需求接收尚未启用，当前不能提交。';else if(caps.bridge==='local_mcp')channel='本机需求记录已启用。保存后需由 dot 通过本机 MCP 读取、受理和回写；此页面不会自动启动任务。';else if(!caps.enabled)channel='通道验收中。现在可以保存需求；保存回执与 dot 实际读取会分别记录，尚未承诺处理时间。';else channel=caps.pollIntervalMinutes?`需求通道已启用。dot 约每 ${caps.pollIntervalMinutes} 分钟检查新需求；以实际读取和处理记录为准。`:'需求通道已启用。提交后先取得保存回执，dot 读取和处理后才会更新状态；读取时间尚未约定。';if(project&&!project.id)channel='项目尚未接入需求通道。这个项目暂时没有可验证的固定项目标识。';$('request-channel').textContent=channel;$('request-channel').className=`request-channel${project?.id&&caps?.enabled?' ready':''}`;
  const selectedTask=draft.contextTaskId || '';const taskOptions=[el('option','','项目整体需求，不关联具体任务')];taskOptions[0].value='';for(const task of projectRequestTasks(project)){const option=el('option','',task.title);option.value=task.id;taskOptions.push(option);}if(selectedTask&&!taskOptions.some(option=>option.value===selectedTask)){const option=el('option','',`${draft.context?.taskTitle || selectedTask} · 原关联任务不在当前快照`);option.value=selectedTask;taskOptions.push(option);}$('request-context-task').replaceChildren(...taskOptions);$('request-context-task').value=selectedTask;$('request-context-task').disabled=!enabled||pending||submitting;
  if($('request-body').value!==draft.body)$('request-body').value=draft.body;$('request-body').disabled=!enabled||submitting;$('request-body').readOnly=pending;$('request-body').maxLength=Math.min(6000,Number(caps?.maxBodyLength)||6000);$('request-length').textContent=`${draft.body.length} / ${$('request-body').maxLength}`;
  $('request-draft-note').textContent=intake.storageWarning?'浏览器不能跨刷新保留草稿，请先保留文字并核对回执':pending?'保存结果待核对，重试会使用同一提交标识与原文':'未提交的草稿仅保留在当前浏览器标签页';renderRequestContext(project,draft);
  const message=intake.messages.get(intake.projectKey);$('request-message').textContent=message?.text || (pending?'上次提交的保存结果尚未确认，请重试核对回执。原文和引用快照已保留。':'');$('request-message').className=`request-message ${message?.tone || (pending?'error':'')}`;
  const context=draft.pending?.payload || draft.context || captureRequestContext(project,draft);$('request-submit').disabled=!enabled||submitting||!draft.body.trim()||!context.viewedSnapshotRevision;$('request-submit').textContent=submitting?'正在保存…':pending?'重试并核对回执':'保存需求';$('request-reload').disabled=intake.capabilityLoading||Boolean(project?.id&&historyFor(project.id).loading);renderRequestHistory();
}
async function loadProjectRequests(projectId,{more=false}={}){
  const history=historyFor(projectId);if(history.loading)return;const cursor=more?history.nextCursor:null;if(more&&!cursor)return;const sequence=++history.sequence;history.loading=true;history.error='';renderIntake();
  try{const result=await requestJson(`/api/projects/${encodeURIComponent(projectId)}/requests${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);if(sequence!==history.sequence)return;if(!Array.isArray(result.requests))throw Error('invalid_response');const receipts=result.requests.filter(receipt=>receiptValid(receipt,projectId));if(receipts.length!==result.requests.length)throw Error('invalid_response');mergeReceipts(history,receipts);history.nextCursor=typeof result.nextCursor==='string'?result.nextCursor:null;history.loaded=true;const draft=currentDraft(projectId);if(draft.pending){const match=receipts.find(receipt=>receiptMatches(receipt,draft.pending));if(match)acceptReceipt(projectId,match);}}
  catch(error){history.error=(error.status===401||error.status===403)?'登录状态不可用，请重新登录后查看需求记录':error.message==='intake_not_ready'?'需求记录通道尚未启用':'暂时无法读取需求记录，保留上次成功读取的内容';}
  finally{history.loading=false;if(requestProject()?.id===projectId)renderIntake();}
}
function renderRequestHistory(){
  const project=requestProject(),history=project?.id?historyFor(project.id):null;$('request-history-count').textContent=history?.loaded?`已显示 ${history.requests.length} 条`:'';$('request-history-message').textContent=history?.error || (history?.loading?'正在读取服务器记录…':'');$('request-more').hidden=!history?.nextCursor;$('request-more').disabled=Boolean(history?.loading);
  if(!project?.id){$('request-list').replaceChildren(el('p','request-empty',project?'项目尚未接入需求通道':'选择项目后查看服务器保存的记录'));$('request-detail').replaceChildren();return;}
  if(!history.requests.length){$('request-list').replaceChildren(el('p','request-empty',history.loaded?'本项目暂时没有已保存的需求':intake.capabilities?.storageAvailable?'尚未读取需求记录':'需求存储尚未接通'));}else $('request-list').replaceChildren(...history.requests.map(receipt=>{const row=button('request-record',undefined,()=>loadRequestDetail(receipt.id,project.id));row.dataset.receiptId=receipt.id;row.setAttribute('aria-pressed',String(intake.selectedReceipt===receipt.id));const top=el('div','request-record-top');top.append(el('span',`request-status${['needs_confirmation','blocked'].includes(receipt.status)?' attention':''}`,requestStatus(receipt.status)),el('span','request-record-time',formatted(receipt.createdAt)));row.append(top,requestPlain('p','request-record-body',receipt.body));if(receipt.latestSummary)row.append(el('p','request-record-summary',receipt.latestSummary));return row;}));
  const detail=intake.selectedReceipt?intake.details.get(intake.selectedReceipt):null;if(detail?.projectId===project.id)renderRequestDetail(detail);else $('request-detail').replaceChildren();
}
async function loadRequestDetail(id,projectId){
  const sequence=(intake.details.get(id)?.sequence || 0)+1;intake.selectedReceipt=id;intake.details.set(id,{projectId,loading:true,sequence});renderRequestHistory();
  try{const result=await requestJson(`/api/requests/${encodeURIComponent(id)}`);if(intake.details.get(id)?.sequence!==sequence)return;if(!receiptValid(result.request,projectId)||result.request.id!==id||!Array.isArray(result.events))throw Error('invalid_response');intake.details.set(id,{projectId,request:result.request,events:result.events,eventsTruncated:result.eventsTruncated===true,loading:false,sequence});mergeReceipts(historyFor(projectId),[result.request]);}
  catch{if(intake.details.get(id)?.sequence!==sequence)return;intake.details.set(id,{projectId,loading:false,sequence,error:'暂时无法读取这条需求的处理记录，请点击记录重试'});}
  renderRequestHistory();
}
function appendRequestTasks(parent,ids){const links=el('div','request-task-links');for(const id of list(ids)){const task=taskById(id);if(task){const node=button('',task.title,()=>{ui.view='projects';ui.project=task.project;ui.filter='all';ui.query='';$('search').value='';ui.selected={type:'task',id};ui.fromAgent=null;ui.detailOpen=true;render();$('inspector').scrollIntoView({block:'start',behavior:'auto'});$('inspector').focus({preventScroll:true});});links.append(node);}else links.append(el('span','request-receipt-meta',`关联工作 ${id}（不在当前任务快照中）`));}if(links.childElementCount)parent.append(links);}
function renderRequestDetail(detail){const target=$('request-detail');if(detail.loading){target.replaceChildren(el('p','request-empty','正在读取处理记录…'));return;}if(detail.error){target.replaceChildren(el('p','request-history-message',detail.error));return;}const receipt=detail.request,fragment=document.createDocumentFragment();fragment.append(el('h4','',requestStatus(receipt.status)),requestPlain('p','request-detail-body',receipt.body));const meta=el('div','request-receipt-meta');meta.append(el('p','',`服务器回执：${receipt.id}`),el('p','',`保存于 ${formatted(receipt.createdAt)} · 最近更新 ${formatted(receipt.updatedAt)}`),el('p','',`引用快照：${receipt.viewedSnapshotRevision} · 导入于 ${formatted(receipt.viewedSnapshotImportedAt)}`));if(receipt.contextTaskId)meta.append(el('p','',`提交时关联任务：${taskById(receipt.contextTaskId)?.title || receipt.contextTaskId}`));if(receipt.contextStale)meta.append(el('p','context-stale','这条需求引用了较早的快照；原始上下文已保留'));fragment.append(meta);if(receipt.contextSummary){const context=el('details','more-details');context.append(el('summary','','查看提交时的上下文'),requestPlain('p','',receipt.contextSummary));fragment.append(context);}appendRequestTasks(fragment,receipt.linkedTaskIds);
  const events=el('ol','request-timeline');for(const event of detail.events){if(!Object.hasOwn(REQUEST_STATUS,event.status))continue;const item=el('li',''),head=el('div','request-timeline-heading');head.append(el('strong','',requestStatus(event.status)),el('time','',formatted(event.createdAt)));item.append(head);if(event.summary)item.append(el('p','',event.summary));appendRequestTasks(item,event.linkedTaskIds);if(list(event.evidenceLinks).length)appendEvidence(item,event.evidenceLinks);events.append(item);}if(detail.eventsTruncated)fragment.append(el('p','request-receipt-meta','这里只显示最近 100 条处理记录'));if(events.childElementCount)fragment.append(events);else fragment.append(el('p','request-empty','尚未附处理事件。当前状态仅以上方服务器记录为准。'));target.replaceChildren(fragment);}
async function submitProjectRequest(event){
  event?.preventDefault();const project=requestProject();if(!project?.id||!intake.capabilities?.canSubmit||!intake.capabilities.storageAvailable||intake.submitting.has(project.id))return;const key=project.id,draft=currentDraft(key);if(!draft.body.trim())return;
  if(!draft.pending){if(!globalThis.crypto?.randomUUID){intake.messages.set(key,{tone:'error',text:'当前浏览器无法生成安全的提交标识，请保留草稿后更新浏览器'});renderIntake();return;}draft.context ||= captureRequestContext(project,draft);draft.pending={payload:{clientSubmissionId:crypto.randomUUID(),body:draft.body,contextTaskId:draft.contextTaskId || null,viewedSnapshotRevision:draft.context.viewedSnapshotRevision,viewedSnapshotImportedAt:draft.context.viewedSnapshotImportedAt,contextSummary:draft.context.contextSummary || ''}};persistIntakeDrafts();}
  intake.submitting.add(key);intake.messages.delete(key);renderIntake();
  try{const result=await requestJson(`/api/projects/${encodeURIComponent(key)}/requests`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(draft.pending.payload)});if(!receiptValid(result.request,key)||!receiptMatches(result.request,draft.pending))throw Error('invalid_response');acceptReceipt(key,result.request);if(requestProject()?.id===key){intake.selectedReceipt=result.request.id;void loadRequestDetail(result.request.id,key);}}
  catch(error){const definitive=error.message==='intake_not_ready'||(error.status===409&&error.message==='task_project_mismatch')||(error.status>=400&&error.status<500&&error.status!==408&&error.status!==409&&error.status!==429);if(definitive){draft.pending=null;if(/snapshot/.test(error.message))draft.context=null;persistIntakeDrafts();}intake.messages.set(key,{tone:'error',text:intakeErrorMessage(error.message,error.status)});}
  finally{intake.submitting.delete(key);renderIntake();void loadInbox();}
}
$('request-project').addEventListener('change',()=>chooseIntakeProject($('request-project').value));
$('request-context-task').addEventListener('change',()=>{const draft=currentDraft();if(draft.pending)return;draft.contextTaskId=$('request-context-task').value || null;draft.context=captureRequestContext(requestProject(),draft);persistIntakeDrafts();renderIntake();});
$('request-body').addEventListener('input',()=>{const draft=currentDraft();if(draft.pending)return;draft.body=$('request-body').value;if(!draft.context)draft.context=captureRequestContext(requestProject(),draft);intake.messages.delete(intake.projectKey);persistIntakeDrafts();renderIntake();});
$('request-form').addEventListener('submit',submitProjectRequest);$('request-reload').addEventListener('click',()=>{void loadIntakeCapabilities();void loadInbox();const project=requestProject();if(project?.id)void loadProjectRequests(project.id);if(intake.selectedReceipt&&project?.id)void loadRequestDetail(intake.selectedReceipt,project.id);});$('request-more').addEventListener('click',()=>{const project=requestProject();if(project?.id)void loadProjectRequests(project.id,{more:true});});
const dispatchQueue=createQueueControls($('managed-queue'),{requestJson,getTaskContext:queueTaskContext,onNewRequest:()=> $('open-request').click(),onOpenTask:id=>selectItem('task',id),onOpenAgent:id=>selectItem('agent',id),getHighlightedProject:()=>ui.project,onSnapshot:snapshot=>{queueSnapshot=snapshot;if(board)preserveFocus(()=>{renderProjects();renderFilters();renderRows();renderCollaboration();});refreshQueueContext(snapshot);}});
$('refresh').addEventListener('click',()=>void dispatchQueue.refresh());
void dispatchQueue.refresh();
setInterval(()=>{if(!document.hidden&&!dispatchQueue.getState().pending){void dispatchQueue.refresh();if(!$('refresh').disabled)void refresh();}},30000);
restoreIntakeDrafts();void refresh();void loadIntakeCapabilities();

function showRequestPanel(focus=true){
  const panel=$('request-panel');$('request-anchor').append(panel);panel.classList.add('is-inline');panel.open=true;
  $('open-request').setAttribute('aria-expanded','true');
  panel.scrollIntoView({block:'nearest',behavior:'auto'});
  if(focus)(requestProject()?.id&&!$('request-body').disabled?$('request-body'):$('request-project')).focus({preventScroll:true});
}
function closeRequestPanel(){const panel=$('request-panel');panel.open=false;panel.classList.remove('is-inline');$('request-home').append(panel);$('open-request').setAttribute('aria-expanded','false');$('open-request').focus({preventScroll:true});$('open-request').scrollIntoView({block:'nearest',behavior:'auto'});}
$('open-request').addEventListener('click',()=>showRequestPanel());
$('close-request').addEventListener('click',closeRequestPanel);

function closeInspector(){ui.detailOpen=false;$('inspector').hidden=true;const target=[...document.querySelectorAll('[data-focus-key], [data-queue-focus]')].find(node=>(node.dataset.focusKey||node.dataset.queueFocus)===ui.detailFocusKey);(target||$('workspace')).focus({preventScroll:true});}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.detailOpen){event.preventDefault();closeInspector();}});

$('content-type').addEventListener('change',()=>{ui.contentType=$('content-type').value;render();});
