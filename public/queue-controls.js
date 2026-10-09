import {effectiveExecutionState,registeredProjectTotals} from './project-overview.js';
import {createRolePortrait} from './collaboration-graph.js';
const PENDING_KEY = 'dot-board-queue-reorder-v1';
const STATES = {queued:'排队中',claimed:'已预留名额',dispatching:'正在派发',assigned:'已绑定，待执行确认',running:'有效证据：执行中',unknown:'当前执行状态未知',blocked:'受阻',uncertain:'执行结果待核对',completed:'已返回结果',failed:'执行失败',canceled:'已取消'};
const ENVIRONMENTS = {native_cloud:'云端任务',coding_environment:'编码环境',computer:'已指定电脑',existing_thread:'原线程保留的执行环境'};
const safeText = (value, fallback='') => typeof value==='string' && !/(?:__external_|\/workspace\/|\/user_notes\/|\/agent_notes\/|\/root\/|dream_notes|system\s*prompt)/i.test(value) ? value : fallback;
const reorderable = job => effectiveExecutionState(job)==='queued' && job.holdsSlot===false && job.canReorder===true;
const pendingValid = value => value && typeof value.eventId==='string' && value.eventId.length<=100 && Array.isArray(value.items) && value.items.length>0 && value.items.length<=500 && value.items.every(item=>item && typeof item.id==='string' && item.id.length>0 && item.id.length<=200 && Number.isSafeInteger(item.expectedVersion) && item.expectedVersion>0) && new Set(value.items.map(item=>item.id)).size===value.items.length;
function snapshotValid(value){return value && typeof value.enabled==='boolean' && Array.isArray(value.jobs) && value.jobs.every(job=>job && typeof job.id==='string' && Number.isSafeInteger(job.version) && job.version>0 && typeof job.state==='string') && new Set(value.jobs.map(job=>job.id)).size===value.jobs.length && (!value.enabled || value.coverage?.scope==='managed_queue');}
export function orderedQueue(snapshot){return (snapshot?.jobs || []).filter(job=>effectiveExecutionState(job)==='queued').sort((a,b)=>(a.queueRank??Infinity)-(b.queueRank??Infinity) || b.priority-a.priority);}
export function moveQueueItem(ids,id,index){const result=ids.filter(value=>value!==id);if(result.length===ids.length)return ids.slice();result.splice(Math.max(0,Math.min(index,result.length)),0,id);return result;}

export function createQueueControls(container,{requestJson,storage,uuid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now(),getTaskContext=()=>null,onOpenTask,onOpenAgent,onSnapshot,getHighlightedProject=()=>'',onNewRequest}={}){
  const doc=container.ownerDocument;
  if(storage===undefined){try{storage=globalThis.sessionStorage;}catch{storage=null;}}
  let snapshot=null,pending=null,loading=false,saving=false,destroyed=false,refreshSequence=0,drag=null,storageWarning=false,completionOpen=null,historyOpen=false,queueInfoOpen=false;
  let message='',tone='',conflictNeedsRefresh=false,focusKey=null,rendering=false,ageSignature='',lastNotifiedSnapshot=null;
  const openJobs=new Set();
  const element=(tag,className,value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=safeText(String(value));return node;};
  const button=(label,action,className='queue-button')=>{const node=element('button',className,label);node.type='button';node.addEventListener('click',action);return node;};
  const time=value=>value && Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(value))+' UTC':'未记录';
  const evidenceSignature=()=>JSON.stringify([(snapshot?.jobs||[]).map(job=>[job.id,effectiveExecutionState(job,now())]),registeredProjectTotals(snapshot?.projectTotals,now()).map(project=>[project.projectId,project.current.map(item=>item.taskNumber),project.unverifiedRunning])]);
  const currentProjectLabel=project=>!project?'未提供':project.current.length?project.current.map(item=>'#'+item.taskNumber).join('、'):project.unverifiedRunning.length?'待核实 '+project.unverifiedRunning.map(number=>'#'+number).join('、'):'无有效执行证据';
  const executionLabel=job=>{const state=effectiveExecutionState(job,now()),old=state==='unknown'&&(job.lifecycleState==='running'||job.state==='running');return {state,old,text:`${STATES[state]||'状态待核实'}${old?' · 证据已过期或缺失':''}`};};
  const persist=()=>{try{if(pending)storage?.setItem(PENDING_KEY,JSON.stringify(pending));else storage?.removeItem(PENDING_KEY);if(!storage&&pending)storageWarning=true;}catch{storageWarning=true;}};
  try{const saved=storage?.getItem(PENDING_KEY);if(saved){const value=JSON.parse(saved);if(pendingValid(value)){pending={eventId:value.eventId,items:value.items.map(({id,expectedVersion})=>({id,expectedVersion}))};message='上次排序的保存结果待核对。请重试原请求，核实前不能再次调整顺序。';tone='warning';}else storage?.removeItem(PENDING_KEY);}}catch{storageWarning=true;}
  const queued=()=>orderedQueue(snapshot);
  const canSort=()=>Boolean(snapshot?.enabled && (snapshot.coverage?.queuedComplete===true || !snapshot.coverage?.truncated && snapshot.coverage?.total===snapshot.jobs.length) && queued().length<=500 && queued().every(reorderable) && !pending && !saving && !loading && !conflictNeedsRefresh);
  // Replacing a focused control moves browser focus to the document. Keep its
  // identity while disabled, but never reclaim focus after the user moves it.
  const focusChanged=()=>{if(!rendering)focusKey=null;};
  doc.addEventListener('focusin',focusChanged);
  function rememberFocus(){const active=doc.activeElement;if(container.contains(active)&&active?.dataset?.queueFocus)focusKey=active.dataset.queueFocus;else if(active&&active!==doc.body&&active!==doc.documentElement)focusKey=null;}
  function restoreFocus(){
    if(!focusKey)return;const nodes=[...container.querySelectorAll('[data-queue-focus]')];let target=nodes.find(node=>node.dataset.queueFocus===focusKey);
    if((!target||target.disabled)&&!loading&&!saving&&!pending&&!conflictNeedsRefresh){const handleKey=/^(?:up|down):/.test(focusKey)?focusKey.replace(/^(?:up|down):/,'handle:'):null;target=nodes.find(node=>node.dataset.queueFocus===handleKey&&!node.disabled)||nodes.find(node=>node.dataset.queueFocus==='refresh'&&!node.disabled);}
    if(target&&!target.disabled){target.focus({preventScroll:true});if(doc.activeElement===target)focusKey=null;}
  }
  function clearDrag(){if(!drag)return;const current=drag;drag=null;const announcement=container.querySelector('.queue-drag-announcement');if(announcement){announcement.textContent='';announcement.classList.remove('queue-drag-announcement');}current.row.classList.remove('is-dragging');for(const row of current.rows){row.classList.remove('queue-drop-before','queue-drop-after');}current.handle.setAttribute('aria-pressed','false');if(current.handle.hasPointerCapture?.(current.pointerId))current.handle.releasePointerCapture(current.pointerId);}
  function updateDragTarget(event){
    if(!drag||drag.pointerId!==event.pointerId)return;
    if(Math.abs(event.clientY-drag.startY)>4)drag.moved=true;
    const bounds=drag.list.getBoundingClientRect();
    drag.valid=Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&event.clientX>=bounds.left-30&&event.clientX<=bounds.right+30&&event.clientY>=bounds.top-40&&event.clientY<=bounds.bottom+40;
    drag.index=drag.rows.filter(item=>item!==drag.row).filter(item=>{const box=item.getBoundingClientRect();return event.clientY>box.top+box.height/2;}).length;
  }
  function render(){
    if(destroyed)return;rememberFocus();rendering=true;clearDrag();
    const header=element('div','queue-heading'),title=element('div','queue-title');const h2=element('h2','','执行队列');h2.id='managed-queue-heading';title.append(h2,element('p','queue-scope','所有项目 · 按已保存顺序认领'));
    const reload=button(loading?'读取中…':'更新队列',()=>void refresh());reload.disabled=loading||saving;reload.dataset.queueFocus='refresh';header.append(title,reload);
    const status=element('p',`queue-message ${tone}`,message || (loading?'正在读取管理队列…':''));status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    const body=element('div','queue-body');
    if(!snapshot){body.append(element('p','queue-empty',loading?'正在核对服务器记录…':'暂时没有可读取的队列记录'));}
    else if(!snapshot.enabled){body.append(element('p','queue-empty','尚未接入执行队列。已有项目和任务可在下方“项目资料与其他记录”中查看。'));}
    else{
      const counts=snapshot.counts||{},metrics=element('div','queue-metrics');
      const capacity=Number.isSafeInteger(snapshot.capacity)?snapshot.capacity:'未配置';
      if(Number.isSafeInteger(counts.heldSlots)){const slots=element('span','queue-slot-count');slots.append(element('strong','',String(counts.heldSlots)),element('span','',` / ${capacity} 名额已占用`));metrics.append(slots);}
      if(Number.isSafeInteger(counts.queued))metrics.append(element('span','',`${counts.queued} 项排队`));
      for(const [label,value] of [['受阻',counts.blocked],['待核对',counts.uncertain]])if(Number.isSafeInteger(value)&&value>0)metrics.append(element('span','queue-attention-count',`${value} 项${label}`));
      body.append(metrics);
      const projectSummary=element('div','queue-project-summary');projectSummary.setAttribute('aria-label','项目登记与当前任务');
      const totals=registeredProjectTotals(snapshot.projectTotals,now()),selected=getHighlightedProject(),names=selected?[selected]:[...new Set([...totals.map(project=>project.projectName),...snapshot.jobs.map(job=>safeText(job.projectName,'项目未记录'))])];
      for(const name of names){const project=totals.find(item=>item.projectName===name),line=element('div','queue-project-line');line.append(element('strong','queue-project-name',name));
        for(const [label,value] of [['已登记',project?.registered],['已完成',project?.completed]]){const metric=element('span','queue-project-metric');metric.append(element('span','',label),element('strong','',Number.isSafeInteger(value)?String(value):'未提供'));line.append(metric);}
        const current=element('span','queue-project-current');current.append(element('span','', '当前编号'),element('strong','',currentProjectLabel(project)));current.children[1].dataset.queueProjectCurrent=name;line.append(current);projectSummary.append(line);
      }
      if(!names.length)projectSummary.append(element('p','queue-project-unavailable','项目登记总数 / 已完成 / 当前编号：未提供'));body.append(projectSummary);
      const info=element('details','queue-info');info.open=queueInfoOpen;info.addEventListener('toggle',()=>{queueInfoOpen=info.open;});const infoSummary=element('summary','','范围与排序说明');infoSummary.dataset.queueFocus='info';info.append(infoSummary,element('p','queue-explanation',`全局管理队列跨项目，不随项目筛选变化。每位用户配置容量 ${capacity}；只覆盖已接入的管理任务。${snapshot.automaticExecution===false?'当前由协调者认领执行，排序决定下一次认领顺序。':'排序决定下一次可用名额的认领顺序。'} 已预留和正在执行的任务不会因排序而中断。`));
      const active=snapshot.jobs.filter(job=>effectiveExecutionState(job,now())!=='queued'&&!['completed','canceled'].includes(effectiveExecutionState(job,now())));
      if(active.length){const group=element('div','queue-current');group.append(element('h3','','执行与待处理'));for(const job of active)group.append(renderJob(job));body.append(group);}
      const group=element('div','queue-waiting'),heading=element('div','queue-list-heading');
      const jobs=queued();if(jobs.length){heading.append(element('h3','','接下来'));group.append(heading);group.append(element('p','queue-help','顺位决定认领顺序，# 编号固定。拖动或用箭头调整，松开即保存。'));
        const list=element('ol','queue-list');list.setAttribute('aria-label','全局排队顺序');jobs.forEach((job,index)=>list.append(renderJob(job,{index,list,ids:jobs.map(item=>item.id)})));group.append(list);
      }else if(snapshot.jobs.length)group.append(element('p','queue-empty queue-waiting-empty','当前没有排队任务'));
      else{const empty=element('div','queue-zero');empty.append(element('h3','','队列还没有任务'),element('p','','先提交一项需求，安排这个项目的下一步。'));if(typeof onNewRequest==='function')empty.append(button('新建需求',onNewRequest,'queue-button primary-action'));group.append(empty);}
      body.append(group);
      if(snapshot.coverage?.truncated || snapshot.coverage?.total!==snapshot.jobs.length || jobs.length>500)body.append(element('p','queue-message warning',snapshot.coverage?.queuedComplete===true&&jobs.length<=500?'已显示全部待执行任务，可调整顺序；部分历史记录未展开。':'待执行记录未完整显示，暂不能排序。请更新队列后再试。'));
      const done=snapshot.jobs.filter(job=>job.projectId!=='validation'&&['completed','canceled'].includes(effectiveExecutionState(job,now())));if(done.length){const details=element('details','queue-completed');details.open=completionOpen??(!active.length&&!jobs.length);details.addEventListener('toggle',()=>{completionOpen=details.open;});const completedSummary=element('summary','',`已结束记录 ${done.length}`);completedSummary.dataset.queueFocus='completed';details.append(completedSummary);for(const job of done)details.append(renderJob(job));body.append(details);}
      const historical=snapshot.jobs.filter(job=>job.projectId==='validation'&&['completed','canceled'].includes(effectiveExecutionState(job,now())));if(historical.length){const details=element('details','queue-history');details.open=historyOpen;details.addEventListener('toggle',()=>{historyOpen=details.open;});details.append(element('summary','',`历史验收记录 ${historical.length}（非当前业务任务）`));for(const job of historical)details.append(renderJob(job));body.append(details);}
      if(!snapshot.jobs.length)info.append(element('p','queue-footnote','导入的任务快照不会自动成为可调度任务。'));body.append(info);
    }
    const actions=element('div','queue-actions');if(pending){const retry=button(saving?'正在核对…':'重试原排序并核对',()=>void savePending());retry.disabled=saving;retry.dataset.queueFocus='retry';actions.append(retry);}
    if(storageWarning&&pending)actions.append(element('p','queue-message warning','当前浏览器不能跨刷新保留待核对请求，请先完成核对再刷新页面。'));
    container.replaceChildren(header,status,body,actions);restoreFocus();rendering=false;ageSignature=evidenceSignature();if(snapshot&&snapshot!==lastNotifiedSnapshot){lastNotifiedSnapshot=snapshot;onSnapshot?.(structuredClone(snapshot));}
  }
  function renderJob(job,position){
    const row=element(position?'li':'article',`queue-row${position?' queue-row-sortable':''}`);row.dataset.queueJob=job.id;
    if(getHighlightedProject()===job.projectName)row.classList.add('is-project-highlighted');
    const context=getTaskContext(job),main=element('div','queue-job-main'),identity=element('div','queue-job-identity');
    if(position){const rank=element('span','queue-rank',String(position.index+1).padStart(2,'0'));rank.setAttribute('aria-label',`排队位置 ${position.index+1}`);identity.append(rank);}
    if(Number.isSafeInteger(job.taskNumber)&&job.taskNumber>0){const fixed=element('span','queue-fixed-number');fixed.append(element('span','sr-only','登记 '),element('span','',`#${job.taskNumber}`));fixed.setAttribute('aria-label',`固定任务编号 ${job.taskNumber}`);identity.append(fixed);}else identity.append(element('span','queue-fixed-number','未编号'));
    const copy=element('div','queue-job-copy'),fullTitle=safeText(job.displayTitle||job.title,'未命名任务'),firstLine=fullTitle.split(/\r?\n/)[0],shortTitle=Array.from(firstLine).slice(0,44).join('')+(Array.from(firstLine).length>44?'…':'');
    const title=button(shortTitle,()=>{if(openJobs.has(job.id))openJobs.delete(job.id);else openJobs.add(job.id);render();},'queue-job-title');title.title=fullTitle;title.dataset.queueFocus=`detail:${job.id}`;title.setAttribute('aria-expanded',String(openJobs.has(job.id)));title.setAttribute('aria-label',`查看任务详情：${firstLine}`);
    copy.append(title,element('p','queue-job-project',safeText(job.projectName,'项目未记录')));
    const label=executionLabel(job),state=label.state,stateNode=element('span',`queue-state state-${state}${label.old?' old':''}`,label.text);stateNode.dataset.queueExecutionState=job.id;
    const related=element('div','queue-job-agents');
    if(Array.isArray(context?.agents)&&context.agents.length){for(const agent of context.agents){const node=button(safeText(agent.name,'未命名 Agent'),()=>onOpenAgent?.(agent.id),'queue-agent');node.dataset.queueFocus=`agent:${job.id}:${agent.id}`;node.setAttribute('aria-label',`查看 Agent：${safeText(agent.name,'未命名 Agent')}`);const name=element('span','',safeText(agent.name,'未命名 Agent'));node.replaceChildren(createRolePortrait(doc,agent,'queue-portrait role-portrait'),name);related.append(node);}}
    else related.append(element('span','queue-agent-missing','Agent 未关联'));
    main.append(identity,copy,stateNode,related);
    const detail=element('section','queue-job-detail');detail.hidden=!openJobs.has(job.id);detail.setAttribute('aria-label','任务记录详情');
    detail.append(element('h4','',fullTitle),element('p','queue-job-meta',`${safeText(job.projectName,'项目未记录')} · ${job.threadBound?'执行线程已绑定':'尚未分派'} · ${ENVIRONMENTS[job.environmentType]||'执行环境未记录'}`));
    if(job.reason)detail.append(element('p','queue-reason',`顺序 / 等待原因：${safeText(job.reason,'待核实')}`));
    if(job.currentStep){const step=element('p','queue-reason',state==='running'?`当前步骤：${safeText(job.currentStep,'待核实')}`:'');step.dataset.queueCurrentStep=job.id;step.hidden=state!=='running';detail.append(step);}
    if(job.lastEffectiveAction)detail.append(element('p','queue-job-summary',`最近有效动作：${safeText(job.lastEffectiveAction,'待核实')}`));
    if(job.summary)detail.append(element('p','queue-job-summary',safeText(job.summary)));
    detail.append(element('p','queue-job-time',`队列记录 ${time(job.observedAt)}${job.threadBound||job.lastExecutionObservedAt?` · 最近执行证据 ${time(job.lastExecutionObservedAt)}`:''}`));
    if(job.holdsSlot)detail.append(element('p','queue-reservation','已占用名额，不能拖动；以执行回执确认进展'));
    if(context?.id&&typeof onOpenTask==='function'){const open=button('查看任务与验收',()=>onOpenTask(context.id),'queue-context-link');open.dataset.queueFocus=`context:${job.id}`;detail.append(open);}
    else detail.append(element('p','queue-job-meta','尚无可关联的任务详情，以上为已记录的队列信息'));
    if(position){
      const disabled=!canSort()||!reorderable(job),handle=button('⠿',()=>{},'queue-handle');handle.disabled=disabled;handle.dataset.queueFocus=`handle:${job.id}`;handle.setAttribute('aria-label',`拖动排序：${safeText(job.title,'任务')}；也可使用上下方向键`);handle.setAttribute('aria-pressed','false');handle.title='拖动调整排队优先级';
      const controls=element('div','queue-order-buttons'),up=button('↑',()=>void move(job.id,position.index-1)),down=button('↓',()=>void move(job.id,position.index+1));
      up.disabled=disabled||position.index===0;down.disabled=disabled||position.index===position.ids.length-1;up.setAttribute('aria-label',`上移：${safeText(job.title,'任务')}`);down.setAttribute('aria-label',`下移：${safeText(job.title,'任务')}`);up.dataset.queueFocus=`up:${job.id}`;down.dataset.queueFocus=`down:${job.id}`;controls.append(up,down);
      handle.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();clearDrag();return;}if(['ArrowUp','ArrowDown'].includes(event.key)&&canSort()){event.preventDefault();void move(job.id,position.index+(event.key==='ArrowUp'?-1:1));}});
      handle.addEventListener('pointerdown',event=>{
        if(drag||disabled||!canSort()||event.button!==0||event.isPrimary===false)return;event.preventDefault();event.stopPropagation();handle.focus({preventScroll:true});
        drag={id:job.id,pointerId:event.pointerId,handle,row,list:position.list,rows:[...position.list.children],ids:position.ids,index:position.index,startY:event.clientY,moved:false,valid:true};handle.setAttribute('aria-pressed','true');row.classList.add('is-dragging');handle.setPointerCapture?.(event.pointerId);
      });
      handle.addEventListener('pointermove',event=>{
        if(!drag||drag.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();
        const bounds=drag.list.getBoundingClientRect();
        if(event.clientY<bounds.top+40)drag.list.scrollTop-=12;else if(event.clientY>bounds.bottom-40)drag.list.scrollTop+=12;
        updateDragTarget(event);const others=drag.rows.filter(item=>item!==drag.row);
        for(const item of drag.rows)item.classList.remove('queue-drop-before','queue-drop-after');if(drag.valid&&drag.moved){if(others[drag.index])others[drag.index].classList.add('queue-drop-before');else others.at(-1)?.classList.add('queue-drop-after');statusAnnouncement(`松开后移至第 ${drag.index+1} 位并保存`);}
      });
      handle.addEventListener('pointerup',event=>{if(!drag||drag.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();updateDragTarget(event);const current=drag;clearDrag();if(current.valid&&current.moved)void move(current.id,current.index);else render();});
      handle.addEventListener('pointercancel',event=>{if(drag?.pointerId===event.pointerId){clearDrag();render();}});handle.addEventListener('lostpointercapture',event=>{if(drag?.pointerId===event.pointerId){clearDrag();render();}});
      row.append(handle,main,controls);
    }else row.append(element('span','queue-drag-space'),main);
    row.append(detail);return row;
  }
  function statusAnnouncement(value){const target=container.querySelector('[role="status"]');if(target){target.classList.add('queue-drag-announcement');target.textContent=value;}}
  async function refresh({preserveMessage=false}={}){
    if(destroyed||loading||saving||drag)return;const sequence=++refreshSequence;loading=true;render();
    try{const result=await requestJson('/api/dispatch/queue');if(destroyed||sequence!==refreshSequence)return;if(!snapshotValid(result))throw Error('invalid_response');snapshot=result;conflictNeedsRefresh=false;if(!preserveMessage&&!pending){message='';tone='';}}
    catch(error){if(destroyed||sequence!==refreshSequence)return;message=[401,403].includes(error.status)?'登录状态不可用，请重新登录后查看队列。':`${conflictNeedsRefresh?'队列发生变化，尚未读到新顺序。':'暂时无法读取队列。'}${snapshot?'保留上次记录；请更新队列后再调整。':'请稍后更新队列重试。'}`;tone='error';conflictNeedsRefresh=true;}
    finally{if(!destroyed&&sequence===refreshSequence){loading=false;render();}}
  }
  async function move(id,index){
    if(!canSort())return;const jobs=queued(),ids=jobs.map(job=>job.id),ordered=moveQueueItem(ids,id,index);if(ordered.every((value,i)=>value===ids[i]))return;
    try{const eventId=uuid();if(typeof eventId!=='string'||!eventId)throw Error('missing_uuid');pending={eventId,items:ordered.map(id=>({id,expectedVersion:jobs.find(job=>job.id===id).version}))};}
    catch{message='浏览器无法生成安全的排序标识，请更新浏览器后重试。';tone='error';render();return;}
    persist();await savePending();
  }
  async function savePending(){
    if(destroyed||!pending||saving)return;saving=true;refreshSequence++;loading=false;message='正在保存排队顺序…';tone='';render();let conflict=false;
    try{
      const result=await requestJson('/api/dispatch/reorder',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pending)});
      if(destroyed)return;if(!snapshotValid(result)||!result.enabled)throw Error('invalid_response');snapshot=result;pending=null;persist();conflictNeedsRefresh=false;message='排队顺序已保存，下一次认领会使用服务器中的顺序。';tone='success';
    }catch(error){
      if(destroyed)return;
      if(error.status===409){pending=null;persist();conflictNeedsRefresh=true;conflict=true;message='队列已变化，这次排序未覆盖新记录。正在读取最新顺序，请核对后重新调整。';tone='warning';}
      else if(error.status>=400&&error.status<500&&![408,429].includes(error.status)){pending=null;persist();conflictNeedsRefresh=true;message=[401,403].includes(error.status)?'登录或访问校验未通过，排序未保存。请重新登录后更新队列。':'服务器拒绝本次排序。请更新队列后重新调整。';tone='error';}
      else{message='排序保存结果待核对。请重试原请求；核实前不能再次调整顺序。';tone='warning';}
    }finally{if(!destroyed){saving=false;render();}}
    if(conflict)await refresh({preserveMessage:true});
  }
  render();
  return {refresh,move,retry:savePending,refreshView(){if(!destroyed&&!drag&&!saving)render();},age(){if(destroyed||evidenceSignature()===ageSignature)return;for(const node of container.querySelectorAll('[data-queue-execution-state]')){const job=snapshot.jobs.find(job=>job.id===node.dataset.queueExecutionState);if(job){const label=executionLabel(job);node.textContent=label.text;node.className=`queue-state state-${label.state}${label.old?' old':''}`;}}for(const node of container.querySelectorAll('[data-queue-current-step]')){const job=snapshot.jobs.find(job=>job.id===node.dataset.queueCurrentStep),active=job&&effectiveExecutionState(job,now())==='running';node.hidden=!active;node.textContent=active?`当前步骤：${safeText(job.currentStep,'待核实')}`:'';}for(const node of container.querySelectorAll('[data-queue-project-current]')){const project=registeredProjectTotals(snapshot?.projectTotals,now()).find(item=>item.projectName===node.dataset.queueProjectCurrent);node.textContent=currentProjectLabel(project);}ageSignature=evidenceSignature();},destroy(){destroyed=true;refreshSequence++;clearDrag();focusKey=null;doc.removeEventListener('focusin',focusChanged);},getState(){return {snapshot:structuredClone(snapshot),pending:structuredClone(pending),loading,saving,message,canSort:canSort()};}};
}
