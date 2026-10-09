import {observationFreshness, createRolePortrait} from './collaboration-graph.js';
const list=x=>Array.isArray(x)?x:[];
const safe=(x,f='')=>typeof x==='string'&&!/(?:__external_|\/workspace\/|\/root\/|\/user_notes\/|\/agent_notes\/|dream_notes|system\s*prompt)/i.test(x)?x:f;
const states={reviewing:'复检中',partial:'部分完成',queued:'待开始',canceled:'已取消',running:'执行中',waiting:'等待',blocked:'受阻',paused:'暂停',idle:'空闲',completed:'记录完成',unknown:'状态未知'};
const unique=items=>[...new Map(items.filter(x=>typeof x?.id==='string').map(x=>[x.id,x])).values()];
const taskNumber=value=>Number.isSafeInteger(value)&&value>0?value:null;
const evidenceKinds=new Set(['tool_result','progress_output','active_process']);
export function executionEvidenceFresh(record,now=Date.now()){
 const observed=Date.parse(record?.lastExecutionObservedAt),expires=Date.parse(record?.evidenceExpiresAt);
 return evidenceKinds.has(record?.evidenceType)&&Number.isFinite(observed)&&Number.isFinite(expires)&&observed<=now&&now<expires&&expires>observed;
}
export function effectiveExecutionState(record,now=Date.now()){
 const state=record?.effectiveState??(record?.state==='running'?'unknown':record?.state??'unknown');
 return state==='running'&&!executionEvidenceFresh(record,now)?'unknown':state;
}
export function registeredProjectTotals(value,now=Date.now()){
 return list(value).filter(p=>p&&p.coverage?.scope==='managed_queue'&&p.coverage?.totalsComplete===true&&['registered','completed','removed','activeRegistered'].every(key=>Number.isSafeInteger(p[key])&&p[key]>=0)).map(p=>{
  const current=list(p.current).filter(entry=>taskNumber(entry.taskNumber)&&executionEvidenceFresh(entry,now)).map(entry=>({...entry,currentStep:safe(entry.currentStep)}));
  const expired=list(p.current).filter(entry=>!executionEvidenceFresh(entry,now)).map(entry=>entry.taskNumber);
  return {...p,projectName:safe(p.projectName,'项目未记录'),current,unverifiedRunning:[...new Set([...list(p.unverifiedRunning),...expired].filter(taskNumber))],scopeChanges:list(p.scopeChanges).filter(change=>['registered','removed'].includes(change?.type)&&taskNumber(change.taskNumber)).map(change=>({...change}))};
 });
}
export function ageExecutionBoard(board,now=Date.now()){
 if(!board)return board;
 const records=list(board.queueUpdates?.records),byTask=new Map(records.map(record=>[record.id,record]));
 const taskStates={claimed:'queued',dispatching:'queued',assigned:'queued',uncertain:'blocked',failed:'blocked'};
 const tasks=list(board.tasks).map(task=>{const record=byTask.get(task.id);if(!record)return task;const state=effectiveExecutionState(record,now);return {...task,taskNumber:taskNumber(record.taskNumber)||taskNumber(task.taskNumber),state:taskStates[state]||state,effectiveState:state,currentStep:state==='running'?safe(record.currentStep):null,lastEffectiveAction:safe(record.lastEffectiveAction),evidenceType:record.evidenceType,evidenceExpiresAt:record.evidenceExpiresAt,lastExecutionObservedAt:record.lastExecutionObservedAt};});
 const agents=list(board.agents).map(agent=>{
  const relatedIds=new Set([...list(agent.taskIds),...tasks.filter(task=>list(task.assignedAgentIds).includes(agent.id)).map(task=>task.id)]),related=records.filter(record=>relatedIds.has(record.id));
  if(!related.length)return agent;
  related.sort((a,b)=>(Date.parse(b.observedAt)||0)-(Date.parse(a.observedAt)||0)||(effectiveExecutionState(a,now)==='unknown'?-1:1));
  const record=related[0],state=effectiveExecutionState(record,now),agentState=state==='running'?'running':['completed','failed'].includes(state)?'completed':['blocked','queued','canceled'].includes(state)?'waiting':'unknown';
  return {...agent,activity:{...agent.activity,state:agentState,...(state==='running'?{summary:safe(record.currentStep),observedAt:record.lastExecutionObservedAt}:{}),...(state==='unknown'?{summary:safe(record.lastEffectiveAction)?'最近有效动作：'+safe(record.lastEffectiveAction):'当前执行证据缺失或已过期'}:{}),effectiveState:state,evidenceExpiresAt:record.evidenceExpiresAt}};
 });
 return {...board,tasks,agents,projectTotals:registeredProjectTotals(board.projectTotals??board.queueUpdates?.projectTotals,now)};
}
export function executionExpirySignature(board,now=Date.now()){
 return JSON.stringify([list(board?.queueUpdates?.records).map(record=>[record.id,effectiveExecutionState(record,now)]),registeredProjectTotals(board?.projectTotals??board?.queueUpdates?.projectTotals,now).map(p=>[p.projectId,p.current.map(t=>t.taskNumber),p.unverifiedRunning])]);
}
// A queue row can borrow a task/Agent context only from a matching normalized
// dispatch projection. A thread binding alone never establishes an identity.
export function mappedQueueTaskContext(board,job){
 if(!job||typeof job.id!=='string')return null;
 const id='dispatch:'+job.id,record=list(board?.queueUpdates?.records).find(item=>item.id===id);
 const task=record&&list(board?.tasks).find(item=>item.id===id&&item.project===job.projectName);
 if(!task)return null;
 const agents=list(board?.agents).filter(agent=>list(task.assignedAgentIds).includes(agent.id)||list(agent.taskIds).includes(task.id));
 return {id:task.id,agents};
}
export function withoutManagedQueueTasks(board,queue){
 const mapped=new Set((queue?.enabled?list(queue.jobs):[]).map(job=>mappedQueueTaskContext(board,job)).filter(Boolean).map(context=>context.id));
 return {...board,tasks:list(board?.tasks).filter(task=>!mapped.has(task.id)),...(queue?.enabled&&Array.isArray(queue.projectTotals)?{projectTotals:queue.projectTotals}:{})};
}
export function aggregateProjects(board,{now=Date.now(),staleAfterMinutes=120,project='',query='',taskState='all'}={}){
 board=ageExecutionBoard(board,now);
 const agents=unique(list(board?.agents)),tasks=unique(list(board?.tasks));
 const names=[...new Set([...list(board?.projects).map(p=>safe(typeof p==='string'?p:p?.name)),...tasks.map(t=>safe(t.project)),...agents.flatMap(a=>list(a.projectNames).map(p=>safe(p))),...list(board?.projectTotals).filter(p=>p.registered>0).map(p=>safe(p.projectName))].filter(Boolean))];
 const match=(t,a)=>list(t.assignedAgentIds).includes(a.id)||list(a.taskIds).includes(t.id);
 const mapObservedAgent=a=>{const fresh=observationFreshness(a.activity?.observedAt,now,staleAfterMinutes);return{id:a.id,name:safe(a.name,'Agent'),kind:a.kind,type:a.type,observedAt:a.activity?.observedAt||null,freshness:fresh,state:Object.hasOwn(states,a.activity?.state)?a.activity.state:'unknown',status:a.activity?.state==='running'&&fresh!=='current'?'上次记录执行':states[a.activity?.state]||states.unknown};};
 const projects=names.map(name=>{const ownTasks=tasks.filter(t=>safe(t.project)===name),ownAgents=agents.filter(a=>list(a.projectNames).includes(name)||ownTasks.some(t=>match(t,a)));
  const mappedAgents=ownAgents.map(mapObservedAgent);
  const mappedTasks=ownTasks.map(t=>({id:t.id,taskNumber:taskNumber(t.taskNumber),title:safe(t.title,'未命名任务'),blocker:safe(t.blocker),nextAction:safe(t.nextAction),currentStep:safe(t.currentStep),lastEffectiveAction:safe(t.lastEffectiveAction),state:t.state,status:states[t.state]||safe(t.state,'未知'),observedAt:t.observedAt,freshness:t.effectiveState==='unknown'?'unknown':observationFreshness(t.observedAt,now,staleAfterMinutes),agentIds:ownAgents.filter(a=>match(t,a)).map(a=>a.id),evidenceCount:list(t.evidence).filter(e=>{try{return ['https:','http:'].includes(new URL(e.url).protocol);}catch{return false;}}).length,businessAcceptance:t.verification?.businessAcceptance?.state||'unknown'}));
  const unknown=mappedAgents.filter(a=>a.freshness!=='current'||a.state==='unknown').length,verified=mappedAgents.length-unknown;
  const latestObservation=Math.max(0,...mappedTasks.map(t=>Date.parse(t.observedAt)).filter(value=>Number.isFinite(value)&&value<=now+300000));
  const registered=list(board?.projectTotals).filter(p=>p.projectName===name);
  return{name,registeredTotals:registered.length===1?registered[0]:null,latestObservation,tasks:mappedTasks,agents:mappedAgents,agentIds:mappedAgents.map(a=>a.id),confirmedRunning:verified?mappedAgents.filter(a=>a.freshness==='current'&&a.state==='running').length:null,unverifiedAgents:unknown,recordedCompleted:mappedTasks.filter(t=>t.state==='completed').length,dependencies:[],dependencyStatus:'任务依赖未记录',edges:mappedTasks.flatMap(t=>t.agentIds.map(id=>({from:t.id,to:id,kind:'assignment'}))),latestDeliveries:mappedTasks.filter(t=>t.state==='completed'&&t.evidenceCount>0&&Number.isFinite(Date.parse(t.observedAt))).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))};
 });
 projects.sort((a,b)=>b.latestObservation-a.latestObservation);
 const q=safe(query).toLowerCase(),filtering=Boolean(q)||taskState!=='all';
 const visible=projects.filter(p=>!project||p.name===project).map(p=>{
  if(!filtering)return p;
  const projectMatch=q&&p.name.toLowerCase().includes(q),matchingAgents=new Set(p.agents.filter(a=>q&&a.name.toLowerCase().includes(q)).map(a=>a.id));
  const keptTasks=p.tasks.filter(t=>(taskState==='all'||t.state===taskState)&&(!q||projectMatch||t.title.toLowerCase().includes(q)||t.agentIds.some(id=>matchingAgents.has(id))));
  const taskIds=new Set(keptTasks.map(t=>t.id)),agentIds=new Set(keptTasks.flatMap(t=>t.agentIds));
  const keptAgents=p.agents.filter(a=>agentIds.has(a.id)||(taskState==='all'&&(projectMatch||matchingAgents.has(a.id))));
  const unverified=keptAgents.filter(a=>a.freshness!=='current'||a.state==='unknown').length;
  return {...p,tasks:keptTasks,agents:keptAgents,agentIds:keptAgents.map(a=>a.id),unverifiedAgents:unverified,confirmedRunning:keptAgents.length>unverified?keptAgents.filter(a=>a.freshness==='current'&&a.state==='running').length:null,edges:p.edges.filter(e=>taskIds.has(e.from)),latestDeliveries:p.latestDeliveries.filter(t=>taskIds.has(t.id)),recordedCompleted:keptTasks.filter(t=>t.state==='completed').length};
 }).filter(p=>!filtering||p.tasks.length||p.agents.length||(q&&p.name.toLowerCase().includes(q)&&taskState==='all'));
 const associatedIds=new Set(projects.flatMap(p=>p.agentIds));const unassigned=agents.filter(a=>!associatedIds.has(a.id));const unassignedAgents=unassigned.filter(a=>!q||[safe(a.name),safe(a.role),safe(a.responsibility)].join(' ').toLowerCase().includes(q)).map(mapObservedAgent);
 const countedIds=new Set(visible.flatMap(p=>p.agentIds));const counted=agents.filter(a=>countedIds.has(a.id));const fresh=counted.filter(a=>observationFreshness(a.activity?.observedAt,now,staleAfterMinutes)==='current'&&Object.hasOwn(states,a.activity?.state)&&a.activity.state!=='unknown');
 return{projects:visible,unassignedAgents,unassignedAgentCount:unassigned.length,searchActive:Boolean(q),scope:{projectCount:projects.length,taskCount:tasks.length,agentCount:agents.length},metrics:{projects:visible.length,tasks:visible.reduce((n,p)=>n+p.tasks.length,0),uniqueAgents:countedIds.size,confirmedRunning:fresh.length?fresh.filter(a=>a.activity.state==='running').length:null,unverifiedAgents:counted.length-fresh.length},dependencyStatus:'任务依赖未记录'};
}
export function projectLayout(projects,{compact=false,availableWidth=380}={}){
 const cols=compact?1:projects.length>1?2:1,width=compact?Math.max(300,Math.min(380,availableWidth-24)):cols*740+40,zones=[];let y=20;
 for(let i=0;i<projects.length;i+=cols){const row=projects.slice(i,i+cols),height=Math.max(...row.map(p=>compact?Math.max(180,Math.ceil(p.agents.length/2)*160+p.tasks.length*136+110):Math.max(p.tasks.length*136,p.agents.length*160,180)+110));row.forEach((p,col)=>zones.push({project:p,x:compact?10:24+col*740,y,width:compact?width-20:710,height,compact}));y+=height+30;}
 return{width,height:Math.max(y,400),zones};
}
const memories=new WeakMap();
export function renderProjectOverview(container,model,{onProject,onTask,onAgent,portraits={},contentType='all',supplementary=false}={}){
 const doc=container.ownerDocument;
 const el=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=safe(String(text));return node;};
 const button=(text,fn,key)=>{const node=el('button','po-button',text);node.type='button';node.dataset.focusKey=key;node.addEventListener('click',fn);return node;};
 const memory=memories.get(container)||{scopeOpen:new Set(),helpOpen:false,deliveriesOpen:false,unassignedOpen:false};memories.set(container,memory);
 const root=el('section','project-overview');root.dataset.contentType=contentType;root.dataset.supplementary=String(supplementary);
 const dashboard=el('div','po-dashboard');dashboard.setAttribute('aria-label','当前筛选范围');
 for(const [title,value,note] of [['项目',model.metrics.projects,`已导入 ${model.scope.projectCount} 个，非全量`],['任务',model.metrics.tasks,'完成记录不等于业务验收'],['Agent',model.metrics.uniqueAgents,'同一身份不重复计数'],['确认执行',model.metrics.confirmedRunning===null?'待核实':model.metrics.confirmedRunning,`${model.metrics.unverifiedAgents} 位过期 / 未核实`]]){
  const metric=el('div','po-metric');metric.title=note;metric.setAttribute('aria-label',`${title} ${value}，${note}`);metric.append(el('strong','',value),el('span','',title));dashboard.append(metric);
 }
 root.append(dashboard);
 const agentButton=(agent,key)=>{
  const node=button('',()=>onAgent?.(agent.id),key);node.className='po-agent';node.setAttribute('aria-label',`查看 ${agent.name} 的 Agent 详情`);node.title=`${agent.name} · ${agent.status}${agent.freshness==='current'?'':' · 待核实'}`;
  node.append(createRolePortrait(doc,agent,'po-portrait role-portrait'));const copy=el('span','po-agent-copy');copy.append(el('strong','',agent.name),el('span','po-agent-status',`${agent.status}${agent.freshness==='current'?'':' · 待核实'}`));node.append(copy);return node;
 };
 let unassignedPanel=null;
 if(contentType!=='tasks'&&list(model.unassignedAgents).length){
  const section=el('details','po-unassigned');section.open=Boolean(model.searchActive)||memory.unassignedOpen;section.addEventListener('toggle',()=>{memory.unassignedOpen=section.open;});
  const heading=el('summary','',`未关联项目的角色 · ${model.unassignedAgents.length}`);heading.dataset.focusKey='po:unassigned';section.append(heading,el('p','','这些角色尚无项目关联记录，不计入项目人数，也不代表没有在工作'));
  const roster=el('div','po-unassigned-roster');for(const agent of model.unassignedAgents){const node=agentButton(agent,'po:unassigned:'+agent.id);node.className='po-unassigned-agent';if(agent.observedAt){const stamp=Date.parse(agent.observedAt);if(Number.isFinite(stamp))node.title+=` · 观察 ${new Date(stamp).toISOString().replace('T',' ').slice(0,16)} UTC`;}roster.append(node);}section.append(roster);unassignedPanel=section;
 }
 if(unassignedPanel&&model.searchActive){root.append(unassignedPanel);unassignedPanel=null;}
 const viewport=el('div','po-viewport');viewport.setAttribute('aria-label','项目、任务与关联 Agent');viewport.dataset.focusKey='po:viewport';
 for(const project of model.projects){
  const zone=el('section','po-zone'),header=el('header','po-zone-header'),identity=el('div','po-project-identity');
  const projectName=safe(project.name),heading=el('h2','');
  const name=projectName&&typeof onProject==='function'?button(projectName,()=>onProject(projectName),'po:project:'+projectName):el('span','',projectName||'项目未关联');name.className='po-zone-title';heading.append(name);
  identity.append(heading,el('p','po-zone-meta',`${project.tasks.length} 项已有任务 · ${project.agents.length} 位关联 Agent`));header.append(identity);
  if(project.unverifiedAgents){const note=el('span','po-project-freshness',`${project.unverifiedAgents} 位 Agent 待核实`);header.append(note);}zone.append(header);
  const totals=project.registeredTotals;
  if(totals){
   const accounting=el('div','po-project-accounting'),current=totals.current.map(entry=>'#'+entry.taskNumber).join('、')||'无有效执行证据';
   accounting.append(el('p','po-accounting-totals',`已登记 ${totals.registered} · 已完成 ${totals.completed} · 已移除 ${totals.removed} · 在册 ${totals.activeRegistered}`));
   accounting.append(el('p','po-accounting-current',`当前执行 ${current}${totals.current.length>1?'（并行 '+totals.current.length+' 项）':''}${totals.unverifiedRunning.length?' · 执行待核实 '+totals.unverifiedRunning.map(n=>'#'+n).join('、'):''}`));
   const changes=el('details','po-scope-changes'),added=totals.scopeChanges.filter(change=>change.type==='registered').length,removed=totals.scopeChanges.filter(change=>change.type==='removed').length;
   changes.open=memory.scopeOpen.has(totals.projectId);changes.addEventListener('toggle',()=>{if(changes.open)memory.scopeOpen.add(totals.projectId);else memory.scopeOpen.delete(totals.projectId);});
   const summary=el('summary','',`范围变更记录：新增 +${added} / 移除 −${removed}${totals.coverage.scopeChangesOmitted?' · 另有 '+totals.coverage.scopeChangesOmitted+' 条未展示':''}`);summary.dataset.focusKey='po:scope:'+totals.projectId;changes.append(summary);
   for(const change of totals.scopeChanges){const stamp=Date.parse(change.recordedAt);changes.append(el('p','',`${change.type==='registered'?'新增登记':'移除'} #${change.taskNumber} · ${Number.isFinite(stamp)?new Date(stamp).toISOString().replace('T',' ').slice(0,19)+' UTC':'时间未记录'}`));}
   if(!totals.scopeChanges.length)changes.append(el('p','','本次未提供范围变更明细'));
   changes.append(el('p','','仅统计已接入管理队列的登记范围，包含完成和移除记录；不代表项目全部计划，编号不会随排序变化'));accounting.append(changes);zone.append(accounting);
  }
  if(contentType==='agents'){
   const roster=el('div','po-project-agents');for(const agent of project.agents)roster.append(agentButton(agent,'po:agent:'+JSON.stringify([project.name,agent.id])));
   if(!project.agents.length)roster.append(el('p','po-zone-empty','尚无关联 Agent 记录'));zone.append(roster);
  }else{
   if(project.tasks.length){
    const columns=el('div','po-columns');columns.setAttribute('aria-hidden','true');columns.append(el('span','','任务 / 最近进展'),el('span','','状态'));if(contentType!=='tasks')columns.append(el('span','','参与 Agent'));zone.append(columns);
    const rows=el('div','po-task-list');
    for(const task of project.tasks){
     const row=el('article','po-task-row');row.dataset.taskId=task.id;
     const taskNode=button('',()=>onTask?.(task.id),'po:task:'+JSON.stringify([project.name,task.id]));taskNode.className='po-task';taskNode.setAttribute('aria-label',`查看任务详情：${task.title}`);
     taskNode.append(el('span','po-task-title',`${task.taskNumber?'#'+task.taskNumber+' · ':''}${task.title}`));
     const progress=task.currentStep?`当前步骤 · ${task.currentStep}`:task.lastEffectiveAction?`最近有效动作 · ${task.lastEffectiveAction}`:task.blocker?`卡点 · ${task.blocker}`:task.nextAction?`下一步 · ${task.nextAction}`:'暂无进展记录';
     const progressNode=el('span',task.blocker&&!task.currentStep&&!task.lastEffectiveAction?'po-task-blocker':'po-task-progress',progress);progressNode.title=progress;taskNode.append(progressNode);
     row.append(taskNode);
     const state=el('div','po-task-state'),status=el('span','po-task-status',task.status);status.dataset.state=task.state;state.append(status);
     if(task.freshness!=='current')state.append(el('span','po-task-freshness','观察待更新'));
     if(task.evidenceCount){const evidence=button(`${task.evidenceCount} 项证据`,()=>onTask?.(task.id),'po:evidence:'+JSON.stringify([project.name,task.id]));evidence.className='po-task-evidence';evidence.setAttribute('aria-label',`查看 ${task.title} 的 ${task.evidenceCount} 项证据`);state.append(evidence);}row.append(state);
     if(contentType!=='tasks'){
      const related=el('div','po-task-agents'),assigned=project.agents.filter(agent=>task.agentIds.includes(agent.id));
      for(const agent of assigned)related.append(agentButton(agent,'po:agent:'+JSON.stringify([project.name,task.id,agent.id])));
      if(!assigned.length)related.append(el('span','po-agent-missing','尚未关联'));row.append(related);
     }
     rows.append(row);
    }
    zone.append(rows);
   }else{
    const empty=el('div','po-zone-empty');empty.append(el('p','',supplementary?'暂无其他观察任务':'尚无任务记录'),el('span','',supplementary?'队列任务已在上方列出；有新增观察记录时会显示在这里':'选择上方“新建需求”，为这个项目补充下一步'));zone.append(empty);
   }
   if(contentType!=='tasks'){
    const linked=new Set(project.tasks.flatMap(task=>task.agentIds)),otherAgents=project.agents.filter(agent=>!linked.has(agent.id));
    if(otherAgents.length){const roster=el('div','po-project-support');roster.append(el('span','po-support-label','项目 Agent'));for(const agent of otherAgents)roster.append(agentButton(agent,'po:agent:'+JSON.stringify([project.name,agent.id])));zone.append(roster);}
   }
  }
  viewport.append(zone);
 }
 if(!model.projects.length){
  const empty=el('div','po-empty');empty.append(el('div','po-empty-mark'),el('h2','',(model.searchActive||model.scope.projectCount>0)?'没有匹配的项目或任务':'项目从这里开始'),el('p','',(model.searchActive||model.scope.projectCount>0)?'试试其他关键词或任务状态':'目前没有可展示的项目记录。接入项目后，任务、进展与参与的 Agent 会显示在这里。'));viewport.append(empty);
 }
 root.append(viewport);if(unassignedPanel)root.append(unassignedPanel);
 const secondary=el('div','po-secondary'),help=el('details','po-help');help.open=memory.helpOpen;help.addEventListener('toggle',()=>{memory.helpOpen=help.open;});
 const helpSummary=el('summary','','状态与统计口径');helpSummary.dataset.focusKey='po:help';help.append(helpSummary,el('p','','状态为观察快照，非实时。仅统计已导入范围，同一角色跨项目不重复计数；任务完成记录不等于业务验收。任务与 Agent 的对应只来自已记录关联，任务依赖未记录。'),el('p','',`当前范围 ${model.metrics.unverifiedAgents} 位角色记录过期或未核实`));secondary.append(help);
 const recent=model.projects.flatMap(project=>project.latestDeliveries.map(task=>({...task,project:project.name}))).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)).slice(0,3);
 const deliveries=el('details','po-deliveries');deliveries.open=memory.deliveriesOpen;deliveries.addEventListener('toggle',()=>{memory.deliveriesOpen=deliveries.open;});const deliverySummary=el('summary','','最近完成记录');deliverySummary.dataset.focusKey='po:deliveries';deliveries.append(deliverySummary);
 if(recent.length)for(const task of recent)deliveries.append(button(`${task.project} · ${task.title}`,()=>onTask?.(task.id),'po:delivery:'+task.id));else deliveries.append(el('p','','当前范围未提供带时间和证据的完成记录'));secondary.append(deliveries);root.append(secondary);
 container.replaceChildren(root);
}

// This association is emitted only after the owner-side server verifies the
// existing task/thread binding; it does not invent an execution observation.
export function originalQueueTaskContext(board,job){
 const id=job?.originalTaskContext?.taskId;if(typeof id!=='string')return null;
 const task=list(board?.tasks).find(task=>task.id===id&&task.project===job.projectName);if(!task)return null;
 return {id:task.id,agents:list(board?.agents).filter(agent=>list(task.assignedAgentIds).includes(agent.id)||list(agent.taskIds).includes(task.id))};
}
