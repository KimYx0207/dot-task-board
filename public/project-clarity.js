import {MANUAL_STATES, manualStatusOf, taskDisplayProjection} from './task-display.js';
export {MANUAL_STATES, manualStatusOf};
import {aggregateProjects, effectiveExecutionState, originalQueueTaskContext} from './project-overview.js';

const list = value => Array.isArray(value) ? value : [];
const safe = (value, fallback = '') => typeof value === 'string' && !/(?:__external_|\/workspace\/|\/user_notes\/|\/agent_notes\/|\/root\/|dream_notes|system\s*prompt)/i.test(value) ? value : fallback;
const memory = new WeakMap();
export function clarityBoard(board){
  const tasks=list(board?.tasks).map(task=>{const display=taskDisplayProjection(task,board?.presentation?.states);return {...task,...display,state:display.displayState};}).sort((a,b)=>Number.isFinite(a.displayStateView?.order)&&Number.isFinite(b.displayStateView?.order)?a.displayStateView.order-b.displayStateView.order||a.title.localeCompare(b.title,'zh-CN'):0);
  return {...board,tasks,displayCounts:Object.fromEntries([...new Set([...Object.keys(board?.presentation?.states||{}),...tasks.map(t=>t.state)])].map(state=>[state,tasks.filter(t=>t.state===state).length]))};
}
const associationOnly = value => /本轮未找到可验证的原任务映射|尚无可关联|无法关联|核验原任务后|等待准确原任务定位/.test(value || '');
const requestStates = {received:'已收到 · 待读取',read:'已读取 · 待处理',accepted:'已受理',needs_confirmation:'待你确认',declined:'未受理',assigned:'已分派',in_progress:'处理中',blocked:'处理受阻',completed:'已返回结果',canceled:'已取消'};

export function utcTime(value) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().replace('T', ' ').slice(5, 16) + ' UTC' : '时间未记录';
}

// A named Agent is an assignment record, not a verified thread or live executor.
export function taskClarity(task, board, queue, now = Date.now(), staleAfterMinutes = 120) {
  const owners = list(board?.agents).filter(agent => list(task.assignedAgentIds).includes(agent.id) || list(agent.taskIds).includes(task.id));
  const execution = (queue?.enabled ? list(queue.jobs) : [])
    .filter(job => job.projectId !== 'validation' && originalQueueTaskContext(board, job)?.id === task.id)
    .sort((a, b) => (Date.parse(b.lastLifecycleObservedAt || b.observedAt) || 0) - (Date.parse(a.lastLifecycleObservedAt || a.observedAt) || 0))[0] || null;
  const executionState = execution ? effectiveExecutionState(execution, now) : null;
  const manual = manualStatusOf(task), display = taskDisplayProjection(task,board?.presentation?.states);
  const stopped = ['paused', 'canceled'].includes(task.state) || ['paused', 'canceled'].includes(manual?.state);
  const observed = Date.parse(task.observedAt);
  const freshness = !Number.isFinite(observed) ? 'unknown' : observed > now + 300000 ? 'future' : now - observed > staleAfterMinutes * 60000 ? 'old' : 'current';
  const observedStatus = task.state === 'paused' ? '已暂停' : task.state === 'canceled' ? '已取消'
    : executionState === 'running' ? '正在执行' : ['claimed', 'dispatching', 'assigned'].includes(executionState) ? '已派发 · 待回执'
    : task.state === 'completed' ? '有完成记录' : task.state === 'partial' ? '部分完成'
    : task.state === 'blocked' ? (freshness === 'current' ? '受阻' : '历史受阻 · 待核实')
    : task.state === 'waiting' ? '等待下一步' : task.state === 'queued' ? '待开始' : '近况待核实';
  const status = manual ? MANUAL_STATES[manual.state] : observedStatus;
  const progress = safe(task.currentStep) || safe(task.lastEffectiveAction) || safe(task.observation) || safe(task.stage) || '尚无具体进展记录';
  const next = display.manualCompleted ? safe(manual.reason) || '已手动标记完成' : stopped ? ((['paused','canceled'].includes(task.state) ? task.state : manual?.state) === 'paused' ? '保持暂停，等待你的新指令' : '保留已有结果，不再继续这项工作') : safe(task.nextAction) || '下一步尚未记录';
  return {task, manual, ...display, history:display.manualCompleted?{blocker:safe(task.blocker),next:safe(task.nextAction)}:null, owners, execution, executionState, threadVerified:Boolean(execution?.threadBound), stopped, freshness, status, progress, next, blocker:display.manualCompleted?'':safe(task.blocker)};
}

function dom(container) {
  const doc = container.ownerDocument;
  const el = (tag, cls = '', value) => { const node = doc.createElement(tag); node.className = cls; if (value !== undefined) node.textContent = safe(String(value)); return node; };
  const button = (label, action, key, cls = 'pc-link') => { const node = el('button', cls, label); node.type = 'button'; node.dataset.focusKey = key; node.addEventListener('click', action); return node; };
  return {el, button};
}

export function renderProjectClarity(container, board, queue, {project = '', query = '', taskState = 'all', contentType = 'all', onProject, onTask, onAgent, onClear, statusController, now = Date.now(), staleAfterMinutes = 120} = {}) {
  const {el, button} = dom(container), model = aggregateProjects(clarityBoard(board), {project, query, taskState, now, staleAfterMinutes});
  const state = memory.get(container) || new Set(); memory.set(container, state);
  const disclosure = (key, label, cls) => { const node = el('details', cls); node.open = state.has(key); node.addEventListener('toggle', () => node.open ? state.add(key) : state.delete(key)); const summary = el('summary', '', label); summary.dataset.focusKey = key; node.append(summary); return node; };
  const root = el('section', 'project-clarity'); root.dataset.contentType = contentType;
  const scope = el('div', 'pc-scope');
  scope.append(el('p', 'pc-scope-count', project ? `当前项目 · ${model.metrics.tasks} 项任务` : `${model.scope.projectCount} 个项目 · ${model.scope.taskCount} 项任务`));
  scope.append(el('span', 'pc-muted', (query || taskState !== 'all') ? `筛选后 ${model.metrics.projects} 个项目 · ${model.metrics.tasks} 项任务` : '已收录的部分记录'));
  root.append(scope);
  const grid = el('div', 'pc-grid'); if (project) grid.classList.add('is-selected');
  for (const group of model.projects) {
    if(contentType === 'agents' && !group.agents.length) continue;
    const section = el('section', 'pc-project'), head = el('header', 'pc-project-head'), h2 = el('h2');
    h2.append(button(group.name, () => onProject?.(group.name), 'pc:project:' + group.name));
    head.append(h2, el('span', 'pc-task-count', `${group.tasks.length} 项任务`)); section.append(head);
    if (contentType === 'agents') {
      const roster = el('div', 'pc-owner-roster');
      for (const owner of group.agents) { const item = el('div', 'pc-roster-person'); item.append(button(owner.name, () => onAgent?.(owner.id), 'pc:agent:' + group.name + ':' + owner.id), el('span', 'pc-muted', '已记录的承接关系 · 当前执行需回执确认')); roster.append(item); }
      if (!group.agents.length) roster.append(el('p', 'pc-empty', '这个项目尚无负责人关联记录'));
      section.append(roster);
    } else for (const mapped of group.tasks) {
      const task = list(board.tasks).find(item => item.id === mapped.id); if (!task) continue;
      const c = taskClarity(task, board, queue, now, staleAfterMinutes), article = el('article', 'pc-task'); article.dataset.taskId = task.id;
      const heading = el('div', 'pc-task-head');
      const title = button((task.taskNumber ? `#${task.taskNumber} · ` : '') + safe(task.title, '未命名任务'), () => onTask?.(task.id), 'pc:task:' + task.id, 'pc-task-title'); title.setAttribute('aria-label', '查看任务详情：' + safe(task.title, '未命名任务'));
      const status = statusController ? createQuickStatus(container,task,c,statusController) : el('span', 'pc-status', c.status); status.dataset.state = c.manual ? c.manual.state : c.stopped ? task.state : c.executionState === 'running' ? 'running' : task.state === 'running' ? 'unknown' : task.state;
      if(c.manual&&!statusController) status.append(el('span','pc-manual-origin','手动'));
      heading.append(title, status); article.append(heading);
      if(statusController)renderQuickStatusFeedback(article,task,statusController);
      if (contentType !== 'tasks' && c.owners.length) {
        const owner = el('div', 'pc-owner'); owner.append(el('span', 'pc-field-label', '负责人'));
        for (const person of c.owners) owner.append(button(safe(person.name, '已记录负责人'), () => onAgent?.(person.id), 'pc:owner:' + task.id + ':' + person.id));
        if(c.executionState === 'running') owner.append(el('span', 'pc-owner-state', '有新执行回执'));
        else if(c.threadVerified) owner.append(el('span', 'pc-owner-state', '原线程已绑定'));
        article.append(owner);
      }
      if(!associationOnly(c.progress)){const progress = el('section', 'pc-progress'); progress.append(el('h3', '', '最新进展'), el('p', 'pc-copy', c.progress));if(task.observedAt)progress.append(el('span', 'pc-stamp', utcTime(task.observedAt) + (c.freshness === 'old' ? ' · 较早记录' : c.freshness === 'future' ? ' · 时间待核实' : '')));article.append(progress);}
      if (c.execution) {
        const label = c.executionState === 'completed' ? '最近一次执行已返回结果' : c.stopped ? '查看既有执行回执' : c.executionState === 'running' ? '查看当前执行回执' : '查看最近执行记录';
        const receipt = disclosure('pc:receipt:' + task.id, label, 'pc-receipt');
        receipt.append(el('p', 'pc-receipt-title', safe(c.execution.displayTitle) || safe(c.execution.title, '本次执行')), el('p', 'pc-copy', safe(c.execution.summary) || safe(c.execution.lastEffectiveAction) || '尚无结果摘要'), el('span', 'pc-stamp', '回执时间：' + utcTime(c.execution.lastExecutionObservedAt || c.execution.lastLifecycleObservedAt || c.execution.observedAt)), el('p', 'pc-receipt-note', '这条回执只对应本次执行，不代表整个项目已完成。')); article.append(receipt);
      }
      if (!c.stopped && c.blocker && !associationOnly(c.blocker)) { const block = disclosure('pc:blocker:' + task.id, (c.freshness === 'current' ? '卡点 · ' : '记录卡点 · ') + Array.from(c.blocker).slice(0, 54).join('') + (Array.from(c.blocker).length > 54 ? '…' : ''), 'pc-blocker'); block.append(el('p', 'pc-copy', c.blocker)); article.append(block); }
      if(!associationOnly(c.next)){const next = el('div', 'pc-next'); next.append(el('h3', '', c.stopped ? '当前安排' : c.manual?.state === 'completed' ? '状态备注' : '下一步'), el('p', 'pc-copy', c.next)); article.append(next);}
      renderTaskHistory(article,c.history);
      const footer = el('div', 'pc-footer'), evidence = list(task.evidence); footer.append(button(evidence.length ? `进展详情 · ${evidence.length} 项证据` : '查看进展详情', () => onTask?.(task.id), 'pc:evidence:' + task.id));
      if (task.state === 'completed' && !c.manual) footer.append(el('span', 'pc-muted', '来源完成记录'));
      article.append(footer);
      section.append(article);
    }
    if (!group.tasks.length && contentType !== 'agents') section.append(el('p', 'pc-empty', '暂无任务记录'));
    grid.append(section);
  }
  if (!model.projects.length) { const empty = el('div', 'pc-empty'); empty.append(el('p', '', '没有匹配的项目或任务')); if (onClear) empty.append(button('清除筛选', onClear, 'pc:clear')); grid.append(empty); }
  root.append(grid); container.replaceChildren(root);
}


export function renderTaskHistory(container,history){
  if(!history||![history.blocker,history.next].some(value=>value&&!associationOnly(value)))return;
  const {el}=dom(container),details=el('details','pc-history');details.append(el('summary','','历史卡点与下一步（手动完成前记录）'));
  for(const [label,value] of [['原卡点',history.blocker],['原下一步',history.next]])if(value&&!associationOnly(value))details.append(el('p','pc-copy',label+'：'+value));
  container.append(details);
}

function createQuickStatus(container,task,clarity,controller){
  const {el}=dom(container),entry=controller.get(task.id),select=el('select','pc-status pc-status-select');
  if(controller.supported?.()===false){const badge=el('span','pc-status',clarity.status);badge.title='当前部署未接通可信的手动状态服务';return badge;}
  select.dataset.focusKey='pc:quick-state:'+task.id;
  select.setAttribute('aria-label',safe(task.title,'这项任务')+'的任务状态，选择后自动保存');
  select.title='手动标记任务状态，不会启动执行';
  const current=el('option','',(entry.loading||entry.saving?'保存中…':clarity.status)+(clarity.manual?' · 手动标记':''));current.value='';current.disabled=true;select.append(current);
  const locked=['paused','canceled'].includes(task.state)?task.state:entry.data?.executionControl?.state;
  for(const [value,label] of Object.entries(MANUAL_STATES)){
    const option=el('option','',label);option.value=value;
    option.disabled=locked==='canceled'&&value!=='canceled'||locked==='paused'&&!['paused','canceled'].includes(value);select.append(option);
  }
  select.value='';select.disabled=entry.loading||entry.saving||Boolean(entry.submission);
  select.addEventListener('change',()=>{
    const value=select.value;if(!value)return;
    void Promise.resolve(controller.quickSave(task,value)).finally(()=>{
      const doc=container.ownerDocument,active=doc.activeElement,key=select.dataset.focusKey;
      // Disabling the saving control can temporarily move focus to the body.
      // Restore it only if the user has not moved to another control meanwhile.
      if(active&&active!==doc.body&&active.dataset?.focusKey!==key)return;
      const replacement=[...(container.querySelectorAll?.('[data-focus-key]')??[])].find(node=>node.dataset.focusKey===key);
      (replacement||doc.getElementById?.('workspace'))?.focus?.({preventScroll:true});
    });
  });
  return select;
}
function renderQuickStatusFeedback(container,task,controller){
  const {el,button}=dom(container),entry=controller.get(task.id);
  if(!entry.error&&!entry.message&&!entry.loading&&!entry.saving)return;
  const feedback=el('div','pc-quick-feedback');
  const note=el('p','pc-status-feedback'+(entry.error?' is-error':''),entry.error||entry.message||(entry.loading?'正在读取当前状态…':'正在保存状态…'));
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');feedback.append(note);
  if(entry.submission&&!entry.saving)feedback.append(button('重试并核对',()=>void controller.save(task),'pc:state-retry:'+task.id));
  else if(entry.error&&!entry.loaded&&!entry.loading)feedback.append(button('重新读取',()=>void controller.open(task,true),'pc:state-reload:'+task.id));
  container.append(feedback);
}

export function renderRequestInbox(container, value, {onOpen, onRetry, onMore, loading = false, error = ''} = {}) {
  const {el, button} = dom(container); container.hidden = false;
  const state = memory.get(container) || new Set(); memory.set(container, state);
  const title = el('div', 'inbox-heading'), heading = el('h2', '', '需求收件箱');
  title.append(heading, button(loading ? '读取中…' : '刷新', () => onRetry?.(), 'inbox:refresh')); title.children[1].disabled = loading;
  const content = [title];
  if (error) { const message = el('p', 'inbox-error', value ? '暂时无法更新，下面保留上次读取的需求。' : '暂时无法读取需求，请稍后重试。'); message.setAttribute('role', 'status'); content.push(message); }
  if (!value) { if (!error) content.push(el('p', '', '正在读取已保存的需求…')); container.replaceChildren(...content); return; }
  const requests = list(value.requests), pending = requests.filter(item => !['completed', 'canceled', 'declined'].includes(item.status));
  const count = el('p', 'inbox-count', `${Number.isSafeInteger(value.unreadCount) ? value.unreadCount : '待核实'} 条待读取 · ${Number.isSafeInteger(value.pendingCount) ? value.pendingCount : '待核实'} 条待处理`); content.push(count);
  const row = receipt => { const item = el('div', 'inbox-row'); item.dataset.receiptId = receipt.id; const open = button(safe(receipt.body, '查看需求'), () => onOpen?.(receipt), 'inbox:request:' + receipt.id, 'inbox-open'); const copy = el('div', 'inbox-row-copy'); copy.append(open, el('span', 'inbox-meta', `${safe(receipt.projectName, '所属项目待核实')} · ${requestStates[receipt.status] || '状态待核实'} · ${utcTime(receipt.createdAt)}`)); item.append(copy); return item; };
  for (const receipt of pending.slice(0, 3)) content.push(row(receipt));
  if (!pending.length) content.push(el('p', 'inbox-empty', '当前范围无待处理需求'));
  if (pending.length > 3) { const more = el('details', 'inbox-more'); more.open = state.has('inbox:more'); more.addEventListener('toggle', () => more.open ? state.add('inbox:more') : state.delete('inbox:more')); const summary = el('summary', '', `另外 ${pending.length - 3} 条待处理需求`); summary.dataset.focusKey = 'inbox:more'; more.append(summary); for (const receipt of pending.slice(3)) more.append(row(receipt)); content.push(more); }
  if (value.nextCursor && onMore) { const more = button(loading ? '读取中…' : '加载更早的待处理需求', () => onMore(), 'inbox:more-page'); more.disabled = loading; content.push(more); }
  if (value.truncated) content.push(el('p', 'inbox-note', `已显示 ${requests.length} 条，待处理总数以顶部统计为准。`));
  container.replaceChildren(...content);
}

function statusResponse(value, taskId) {
  return value?.taskId === taskId && Number.isSafeInteger(value.version) && value.version >= 0 && (value.state === null || Object.hasOwn(MANUAL_STATES, value.state));
}
export function createManualStatusController({requestJson,supported=()=>true,uuid=()=>globalThis.crypto.randomUUID(),onChange=()=>{},onSaved=()=>{}}) {
  const entries = new Map();
  const get = id => { if(!entries.has(id))entries.set(id,{loaded:false,loading:false,saving:false,data:null,draft:'',reason:'',error:'',message:'',submission:null});return entries.get(id); };
  const notify = () => onChange();
  async function read(task, force=false) {
    const entry=get(task.id);if(!supported()){entry.error='当前部署未接通可信的手动状态服务。';notify();return;}if(entry.loading||entry.saving||entry.loaded&&!force)return;
    entry.loading=true;entry.error='';notify();
    try {const data=await requestJson('/api/tasks/'+encodeURIComponent(task.id)+'/status');if(!statusResponse(data,task.id))throw Error('invalid_response');entry.data=data;entry.loaded=true;if(['paused','canceled'].includes(data.executionControl?.state))entry.draft=data.executionControl.state;else if(force||!entry.draft)entry.draft=data.state || (Object.hasOwn(MANUAL_STATES,task.state)?task.state:'');}
    catch {entry.error='暂时无法读取状态，请重试。';entry.loaded=false;}
    finally {entry.loading=false;notify();}
  }
  const api = {get,open:read,supported,
    reason(id,value){const entry=get(id);if(!entry.saving&&!entry.submission)entry.reason=String(value).slice(0,500);},
    choose(id,state){const entry=get(id);if(entry.saving||entry.submission||!Object.hasOwn(MANUAL_STATES,state)||(entry.data?.executionControl?.state==='canceled'&&state!=='canceled'||entry.data?.executionControl?.state==='paused'&&!['paused','canceled'].includes(state)))return;entry.draft=state;entry.error='';entry.message='';notify();},
    async quickSave(task,state){
      const entry=get(task.id);if(entry.loading||entry.saving||entry.submission||!Object.hasOwn(MANUAL_STATES,state))return;
      await read(task);if(!entry.loaded)return;
      const locked=entry.data?.executionControl?.state;
      if(locked==='canceled'&&state!=='canceled'||locked==='paused'&&!['paused','canceled'].includes(state)){
        entry.error='任务已暂停或取消。恢复执行需要在对话中确认。';notify();return;
      }
      // Preserve a previous owner note when changing only the status badge.
      entry.reason=entry.data.reason??entry.reason;api.choose(task.id,state);
      await api.save(task);
    },
    async save(task){
      const entry=get(task.id);if(!supported()||entry.saving||entry.loading||!entry.loaded||!Object.hasOwn(MANUAL_STATES,entry.draft))return;
      if(!entry.submission){let eventId;try{eventId=uuid();}catch{entry.error='无法生成保存标识，请刷新后重试。';notify();return;}entry.submission={expectedVersion:entry.data.version,eventId,state:entry.draft,...(entry.reason.trim()?{reason:entry.reason.trim()}:{})};}
      const payload=entry.submission;entry.saving=true;entry.error='';entry.message='';notify();
      try {const result=await requestJson('/api/tasks/'+encodeURIComponent(task.id)+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!statusResponse(result,task.id)||result.state!==payload.state&&!result.duplicate||result.version<=payload.expectedVersion)throw Error('invalid_response');entry.data=result;entry.draft=result.state;entry.submission=null;entry.message=result.duplicate&&result.state!==payload.state?'已保存过，当前状态已更新为'+MANUAL_STATES[result.state]:'已保存';try{await onSaved(task.id,result);}catch{entry.message='已保存，请刷新查看。';}}
      catch(error){
        if(error.status===409){entry.submission=null;entry.loaded=false;entry.error=error.message==='execution_control_locked'?'任务已暂停或取消。恢复执行需要在对话中确认。':'状态已被更新。请重新读取后再保存。';}
        else if(error.status>=400&&error.status<500&&![408,429].includes(error.status)){entry.submission=null;entry.error=error.status===401||error.status===403?'登录状态已失效，请重新打开私密看板。':'这次状态未保存，请更新记录后重试。';}
        else entry.error='暂时无法确认保存结果，请重试核对。';
      }finally{entry.saving=false;notify();}
    }
  };
  return api;
}

export function renderManualStatusForm(container, task, controller) {
  const {el,button}=dom(container),entry=controller.get(task.id),label=el('label','pc-status-label','任务状态');
  if(controller.supported?.()===false){container.append(el('p','pc-status-feedback','当前部署未接通可信的手动状态服务；任务记录仍可查看。'));return;}
  const select=el('select','pc-state-select');select.setAttribute('aria-label',safe(task.title,'这项任务')+'的任务状态');select.dataset.focusKey='pc:state-select:'+task.id;
  const placeholder=el('option','','选择状态');placeholder.value='';select.append(placeholder);
  for(const [value,title] of Object.entries(MANUAL_STATES)){const option=el('option','',title);option.value=value;option.disabled=entry.data?.executionControl?.state==='canceled'&&value!=='canceled'||entry.data?.executionControl?.state==='paused'&&!['paused','canceled'].includes(value);select.append(option);}
  select.value=entry.draft;select.disabled=!entry.loaded||entry.loading||entry.saving||Boolean(entry.submission);select.addEventListener('change',()=>controller.choose(task.id,select.value));label.append(select);
  const actions=el('div','pc-status-actions');actions.append(label);
  if(entry.loaded){const save=button(entry.saving?'保存中…':entry.submission?'重试并核对':'保存状态',()=>void controller.save(task),'pc:state-save:'+task.id,'pc-save-status');save.disabled=entry.saving||entry.loading||!entry.draft;actions.append(save);}
  else if(!entry.loading)actions.append(button('重新读取',()=>void controller.open(task,true),'pc:state-reload:'+task.id));
  container.append(actions);
  if(entry.loaded){const reasonLabel=el('label','pc-status-reason','备注（可选）'),reason=el('input','');reason.type='text';reason.maxLength=500;reason.value=entry.reason;reason.dataset.focusKey='pc:state-reason:'+task.id;reason.disabled=entry.saving||Boolean(entry.submission);reason.addEventListener('input',()=>controller.reason(task.id,reason.value));reasonLabel.append(reason);container.append(reasonLabel);}
  if(entry.loading)container.append(el('p','pc-status-feedback','正在读取当前状态…'));
  const note=el('p','pc-status-feedback'+(entry.error?' is-error':''),entry.error||entry.message||(['paused','canceled'].includes(entry.data?.executionControl?.state)?'暂停或取消已锁定；恢复请在对话中确认。':'手动状态独立保存，不会启动执行。'));note.setAttribute('role','status');note.setAttribute('aria-live','polite');container.append(note);
}
