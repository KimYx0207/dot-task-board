'use strict';
const $ = id => document.getElementById(id);
const ui = {view:'agents', project:'', filter:'all', query:'', selected:null, fromAgent:null};
let config = null, board = null, requestId = 0, observationSignature = '';
const expandedDetails = new Set();
const dateFormat = new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const AGENT_STATES = {running:{label:'工作中',tone:'blue'},waiting:{label:'等待中',tone:'amber'},blocked:{label:'受阻',tone:'red'},paused:{label:'已暂停',tone:'slate'},idle:{label:'空闲',tone:'slate'},completed:{label:'本轮完成',tone:'green'},unknown:{label:'状态未知',tone:'slate'}};
const ROLE_NAMES = {coordinator:'总体协调',owner:'项目负责人',worker:'执行',reviewer:'复核',researcher:'研究'};
const AGENT_FILTERS = [['all','全部'],['active','确认执行'],['attention','确认等待'],['completed','已完成'],['resting','空闲 / 暂停'],['unknown','待核实']];
const list = value => Array.isArray(value) ? value : [];
const agents = () => list(board?.agents);
const tasks = () => list(board?.tasks);
const agentById = id => agents().find(agent => agent.id === id);
const taskById = id => tasks().find(task => task.id === id);
const isRoot = agent => agent.kind === 'coordinator' && agent.type !== 'subagent';
const text = (value, fallback = '') => typeof value === 'string' && !/(?:\/workspace\/|\/root\/|system\s*prompt)/i.test(value) ? value : fallback;
function el(tag, className, value){const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=text(String(value));return node;}
function button(className, label, action){const node=el('button',className,label);node.type='button';if(action)node.addEventListener('click',action);return node;}
function formatted(value){const date = new Date(value);return value && Number.isFinite(date.getTime()) ? dateFormat.format(date) : '时间未记录';}
function freshness(value){if(!value || !Number.isFinite(Date.parse(value)))return 'unknown';const age=Date.now()-Date.parse(value);return age < -300000 ? 'clock_error' : age > (config?.staleAfterMinutes || 120)*60000 ? 'stale' : 'current';}
function activity(agent){return agent.activity || {state:'unknown'};}
function freshLabel(value){const state=freshness(value);return state==='stale'?'观察已过期':state==='clock_error'?'观察时钟异常':state==='unknown'?'时间待核实':'';}
function agentState(agent){const key=activity(agent).state;const configured=board?.presentation?.agentStates || config?.agentStates || AGENT_STATES;const value=configured[key] || AGENT_STATES[key] || AGENT_STATES.unknown;return key==='running'&&freshness(activity(agent).observedAt)!=='current'?{...value,label:'上次记录执行'}:value;}
function taskState(task){return config?.states?.[task.state] || {label:'待核实',tone:'slate'};}
function badge(value){const tone=['blue','amber','red','green','slate'].includes(value?.tone)?value.tone:'slate';return el('span',`badge ${tone}`,value?.label || '待核实');}
function agentName(agent){return text(agent?.name,'未命名 Agent') || '未命名 Agent';}
function agentTasks(agent){const ids=new Set(list(agent.taskIds));return tasks().filter(task=>ids.has(task.id) || list(task.assignedAgentIds).includes(agent.id));}
function taskAgents(task){return agents().filter(agent=>list(task.assignedAgentIds).includes(agent.id) || list(agent.taskIds).includes(task.id));}
function parentLabel(agent){if(isRoot(agent))return '主 Agent';const parent=agent.relationshipState==='known' ? agentById(agent.parentAgentId) : null;return parent ? `由 ${agentName(parent)} 创建` : '父级关系未核实';}
function inProjectAgent(agent){return !ui.project || list(agent.projectNames).includes(ui.project);}
function inProjectTask(task){return !ui.project || task.project===ui.project;}
function matchesQuery(values){return !ui.query || values.map(value=>text(value)).join(' ').toLocaleLowerCase().includes(ui.query);}
function agentMatches(agent){return inProjectAgent(agent) && matchesQuery([agent.name,agent.role,agent.responsibility,...list(agent.projectNames),activity(agent).summary,activity(agent).blocker,...agentTasks(agent).map(task=>task.title)]);}
function taskMatches(task){return inProjectTask(task) && matchesQuery([task.title,task.project,task.ownerRole,task.stage,task.observation,task.nextAction,task.blocker,...taskAgents(task).map(agent=>agent.name)]);}
function matchesAgentFilter(agent, filter=ui.filter){const state=activity(agent).state;switch(filter){case 'active':return !isRoot(agent) && state==='running' && freshness(activity(agent).observedAt)==='current';case 'attention':return ['waiting','blocked'].includes(state) && freshness(activity(agent).observedAt)==='current';case 'completed':return state==='completed';case 'resting':return ['idle','paused'].includes(state);case 'unknown':return state==='unknown' || ['stale','unknown','clock_error'].includes(freshness(activity(agent).observedAt));default:return true;}}
function visibleItems(){return ui.view==='agents' ? agents().filter(agent=>agentMatches(agent)&&matchesAgentFilter(agent)) : tasks().filter(task=>taskMatches(task)&&(ui.filter==='all'||task.state===ui.filter));}
function preserveFocus(render){const active=document.activeElement,key=active?.dataset?.focusKey;render();if(key){for(const node of document.querySelectorAll('[data-focus-key]'))if(node.dataset.focusKey===key){node.focus({preventScroll:true});break;}}}
function setView(view, filter='all'){ui.view=view;ui.filter=filter;ui.selected=null;ui.fromAgent=null;render();}
function setProject(project){ui.project=project;ui.selected=null;ui.fromAgent=null;render();}
function selectItem(type,id,fromAgent=null){
  const reset=type==='agent'&&!visibleItems().some(item=>item.id===id);
  if(reset){ui.view='agents';ui.project='';ui.filter='all';ui.query='';$('search').value='';}
  ui.selected={type,id};ui.fromAgent=fromAgent;
  if(reset)render();else preserveFocus(()=>{renderRows();renderInspector();});
  if(window.matchMedia('(max-width: 1050px)').matches){$('inspector').scrollIntoView({block:'start',behavior:'auto'});$('inspector').focus({preventScroll:true});}
}
function clearFilters(){ui.query='';ui.filter='all';ui.project='';$('search').value='';ui.selected=null;render();}
function renderSummary(){
  const scoped=agents().filter(inProjectAgent), workers=scoped.filter(agent=>!isRoot(agent));
  const active=workers.filter(agent=>matchesAgentFilter(agent,'active')).length;
  const attention=workers.filter(agent=>matchesAgentFilter(agent,'attention')).length;
  const done=workers.filter(agent=>matchesAgentFilter(agent,'completed')).length;
  const rootCount=scoped.filter(isRoot).length;
  const unverified=workers.filter(agent=>matchesAgentFilter(agent,'unknown')).length;
  const cards=[['已知 Agent',scoped.length,`${rootCount} 主 Agent · ${workers.length} subagent`,'slate','all'],['最近确认执行',active,unverified?`另有 ${unverified} 条过期 / 未核实`:'仅计近期有效观察','green','active'],['最近确认等待 / 受阻',attention,'仅计近期有效观察','amber','attention'],['已完成的 subagent',done,'本轮执行记录','slate','completed']];
  $('summary').replaceChildren(...cards.map(([label,value,note,tone,filter])=>{const card=button('stat-card',undefined,()=>setView('agents',filter));card.setAttribute('aria-label',`${label} ${value}，查看对应 Agent`);const title=el('span','stat-label');title.append(el('span',`stat-dot ${tone}`),document.createTextNode(label));card.append(title,el('strong','stat-value',String(value)),el('span','stat-note',note));return card;}));
}
function projectNames(){return [...new Set([...list(board?.projects).map(project=>typeof project==='string'?project:project?.name),...agents().flatMap(agent=>list(agent.projectNames))].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function renderProjects(){
  const names=projectNames();if(ui.project && !names.includes(ui.project))ui.project='';
  $('project-total').textContent=String(names.length);$('workspace-caption').textContent=ui.project || '全部已知项目';
  const buttons=['',...names].map(name=>{const count=name?tasks().filter(task=>task.project===name).length:tasks().length;const node=button(`project-button${name?'':' all'}`,undefined,()=>setProject(name));node.dataset.focusKey=`project:${name}`;node.setAttribute('aria-pressed',String(name===ui.project));node.title=`${name || '全部已知项目'} · ${count} 项任务`;node.append(el('span','project-dot'),el('span','project-button-title',name || '全部已知项目'),el('span','project-count',String(count)));return node;});
  $('projects').replaceChildren(...buttons);
  $('project').replaceChildren(...['',...names].map(name=>{const option=el('option','',name || '全部已知项目');option.value=name;return option;}));$('project').value=ui.project;
}
function renderFilters(){
  let filters;
  if(ui.view==='agents'){const base=agents().filter(agentMatches);filters=AGENT_FILTERS.map(([key,label])=>[key,label,base.filter(agent=>matchesAgentFilter(agent,key)).length]);}
  else{const base=tasks().filter(taskMatches);filters=[['all','全部',base.length],...Object.entries(config?.states || {}).map(([key,value])=>[key,value.label,base.filter(task=>task.state===key).length]).filter(([, , count])=>count>0)];}
  $('filters').replaceChildren(...filters.map(([key,label,count])=>{const node=button('filter',undefined,()=>{ui.filter=key;ui.selected=null;ui.fromAgent=null;render();});node.dataset.focusKey=`filter:${key}`;node.setAttribute('aria-pressed',String(ui.filter===key));node.append(document.createTextNode(label),el('span','filter-count',String(count)));return node;}));
  $('view-agents').setAttribute('aria-pressed',String(ui.view==='agents'));$('view-tasks').setAttribute('aria-pressed',String(ui.view==='tasks'));
  $('agent-tab-count').textContent=String(agents().filter(inProjectAgent).length);$('task-tab-count').textContent=String(tasks().filter(inProjectTask).length);
}
function avatar(agent){const initial=isRoot(agent)?'d':({owner:'主',worker:'执',reviewer:'验',researcher:'研'}[agent.kind] || 'A');return el('span',`agent-avatar ${isRoot(agent)?'root':agent.kind}`,initial);}
function agentRow(agent){
  const row=button('agent-row',undefined,()=>selectItem('agent',agent.id));row.dataset.focusKey=`agent:${agent.id}`;row.dataset.agentId=agent.id;row.setAttribute('aria-pressed',String(ui.selected?.type==='agent'&&ui.selected.id===agent.id));row.setAttribute('aria-label',`${agentName(agent)}，${agentState(agent).label}，查看详情`);
  const main=el('div','row-main'),title=el('div','row-title-line');title.append(el('span','row-name',agentName(agent)),el('span','type-tag',isRoot(agent)?'主 Agent':agent.type==='subagent'?'subagent':'Agent'));main.append(title,el('p','row-role',agent.role || ROLE_NAMES[agent.kind] || '职责未记录'));
  main.append(el('p','row-summary',activity(agent).summary || agent.responsibility || '工作内容尚未记录'));
  const meta=el('div','row-meta');if(!isRoot(agent))meta.append(el('span',agent.relationshipState==='known'?'relation-label':'',parentLabel(agent)));meta.append(el('span','',`${formatted(activity(agent).observedAt)} 观察`));main.append(meta);
  const end=el('div','row-end');end.append(badge(agentState(agent)));const label=freshLabel(activity(agent).observedAt);if(label)end.append(el('span','freshness-label',label));end.append(el('span','row-chevron','›'));row.append(avatar(agent),main,end);return row;
}
function taskRow(task){
  const row=button('task-row',undefined,()=>selectItem('task',task.id));row.dataset.focusKey=`task:${task.id}`;row.dataset.taskId=task.id;row.setAttribute('aria-pressed',String(ui.selected?.type==='task'&&ui.selected.id===task.id));
  const main=el('div','row-main');main.append(el('div','row-name',task.title),el('p','row-summary',task.blocker || task.observation || task.nextAction || '进展尚未记录'));
  const linked=taskAgents(task),meta=el('div','row-meta');meta.append(el('span','',linked.length?linked.map(agentName).join('、'):'Agent 尚未关联'),el('span','',formatted(task.observedAt)));main.append(meta);
  const end=el('div','row-end');end.append(badge(taskState(task)));const label=freshLabel(task.observedAt);if(label)end.append(el('span','freshness-label',label));row.append(el('span',`task-status-mark ${taskState(task).tone}`),main,end);return row;
}
function groupSection(name, items, renderer, className=''){const section=el('section',`agent-group ${className}`),head=el('div','group-heading');head.append(el('h3','group-title',name),el('span','group-count',`${items.length} ${ui.view==='agents'?'位':'项'}`));const rows=el('div','group-list');rows.append(...items.map(renderer));section.append(head,rows);return section;}
function emptyState(title,hint,action){const node=el('div','empty');node.append(el('h2','',title),el('p','',hint));if(action)node.append(button('',action.label,action.run));return node;}
function ensureSelection(rows){if(ui.fromAgent && ui.selected?.type==='task' && taskById(ui.selected.id) && rows.some(row=>row.id===ui.fromAgent))return;const type=ui.view==='agents'?'agent':'task';if(ui.selected?.type===type && rows.some(row=>row.id===ui.selected.id))return;const first=ui.view==='agents' ? rows.find(agent=>matchesAgentFilter(agent,'active')) || rows[0] : rows[0];ui.selected=first?{type,id:first.id}:null;ui.fromAgent=null;}
function renderRows(){
  const rows=visibleItems();ensureSelection(rows);$('result-count').textContent=`${rows.length} ${ui.view==='agents'?'位 Agent':'项任务'}`;
  $('results-label').textContent=ui.view==='agents'?'谁在做什么':'任务进展';$('relationship-note').textContent=ui.view==='agents'?'主 Agent 单列；按项目归类，创建关系以实际记录为准':'任务状态独立记录；执行完成不代表已部署或已验收';
  if(ui.view==='agents'&&!agents().length){$('rows').replaceChildren(emptyState('Agent 运行信息尚未接入','已有任务记录不会被猜成 Agent。可以先查看任务进展。',{label:'查看任务进展',run:()=>setView('tasks')}));return;}
  if(!rows.length){$('rows').replaceChildren(emptyState('没有符合条件的记录','换个状态或项目，或者清空搜索试试',{label:'清除筛选',run:clearFilters}));return;}
  const groups=new Map(),nodes=[];
  if(ui.view==='agents'){const roots=rows.filter(isRoot);if(roots.length)nodes.push(groupSection('总体协调',roots,agentRow,'coordinator-block'));for(const agent of rows.filter(agent=>!isRoot(agent))){const project=ui.project || list(agent.projectNames)[0] || '项目未分配';if(!groups.has(project))groups.set(project,[]);groups.get(project).push(agent);}}
  else{for(const task of rows){const project=task.project || '未分类';if(!groups.has(project))groups.set(project,[]);groups.get(project).push(task);}}
  for(const [name,items] of groups)nodes.push(groupSection(name,items,ui.view==='agents'?agentRow:taskRow));$('rows').replaceChildren(...nodes);
}
function detailSection(title,icon,value,missing='暂无记录'){const node=el('section','detail-section'),head=el('h3','');head.append(el('span','section-icon',icon),document.createTextNode(title));node.append(head);if(value!==undefined)node.append(el('p',value?'':'missing',value || missing));return node;}
function appendPairs(parent,pairs){const dl=el('dl','detail-pairs');for(const [key,value] of pairs)dl.append(el('dt','',key),el('dd','',value || '未记录'));parent.append(dl);}
function appendEvidence(parent,items){const links=el('div','evidence-links');for(const item of list(items)){try{const url=new URL(item.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;const link=el('a','',item.label || '查看结果');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';links.append(link);}catch{}}
  if(links.childElementCount)parent.append(links);else parent.append(el('p','missing','尚未附可打开的产出链接'));
}
function inspectorTop(type){const top=el('div','inspector-topline');top.append(el('span','',type==='agent'?'AGENT 详情':'任务详情'));const back=button('inspector-back mobile-back','↑ 返回列表',()=>{const node=document.querySelector(`[data-focus-key="${type}:${ui.selected?.id}"]`) || $('workspace');node.scrollIntoView({block:'center',behavior:'auto'});node.focus({preventScroll:true});});top.append(back);return top;}
function agentInspector(agent){
  const fragment=document.createDocumentFragment();fragment.append(inspectorTop('agent'));
  const identity=el('div','inspector-identity'),title=el('div','');title.append(el('h2','',agentName(agent)),el('p','',`${isRoot(agent)?'主 Agent':'subagent'} · ${agent.role || ROLE_NAMES[agent.kind] || '职责未记录'}`));identity.append(avatar(agent),title);fragment.append(identity);
  const status=el('div','inspector-status');status.append(badge(agentState(agent)),el('span','',freshLabel(activity(agent).observedAt) || '近期观察'));fragment.append(status);
  if(agent.responsibility)fragment.append(el('p','inspector-description',agent.responsibility));
  const doing=detailSection('正在做什么','◉',activity(agent).summary,'尚未记录当前工作');doing.append(el('p','time-note',`观察于 ${formatted(activity(agent).observedAt)} · 此记录不是实时心跳`));fragment.append(doing);
  const waiting=detailSection('等待与下一步','⌁');if(activity(agent).blocker){const block=el('div','attention-box');block.append(el('strong','',['waiting','blocked'].includes(activity(agent).state)?'停在这里的原因':'已记录的限制'),document.createTextNode(text(activity(agent).blocker)));waiting.append(block);}else waiting.append(el('p','missing',['waiting','blocked'].includes(activity(agent).state)?'当前为等待 / 受阻状态，具体原因尚未记录':'这次观察没有记录阻塞原因'));
  if(activity(agent).nextAction){const next=el('div','next-action');next.append(el('strong','','下一步'),document.createTextNode(text(activity(agent).nextAction)));waiting.append(next);}fragment.append(waiting);
  const result=detailSection('最近产出','↗',agent.latestResult?.summary,'尚未收到本轮产出记录');if(agent.latestResult){if(agent.latestResult.observedAt)result.append(el('p','time-note',formatted(agent.latestResult.observedAt)));appendEvidence(result,agent.latestResult.evidence);}fragment.append(result);
  const related=agentTasks(agent),taskSection=detailSection(`关联任务 · ${related.length}`,'▤');
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
  fragment.append(el('h2','inspector-title',task.title));const status=el('div','inspector-status');status.append(badge(taskState(task)),el('span','',freshLabel(task.observedAt) || '近期观察'));fragment.append(status);
  const progress=detailSection('进展记录','◉',task.observation,'尚未记录具体进展');appendPairs(progress,[['项目',task.project],['阶段',task.stage],['任务角色',task.ownerRole || '角色未记录'],['观察时间',formatted(task.observedAt)]]);fragment.append(progress);
  const next=detailSection('等待与下一步','⌁');if(task.blocker){const block=el('div','attention-box');block.append(el('strong','','停在这里的原因'),document.createTextNode(text(task.blocker)));next.append(block);}if(task.nextAction){const node=el('div','next-action');node.append(el('strong','','下一步'),document.createTextNode(text(task.nextAction)));next.append(node);}else next.append(el('p','missing','下一步尚未记录'));if(task.nextOwnerRole)next.append(el('p','time-note',`下一步负责人 · ${task.nextOwnerRole}`));fragment.append(next);
  const linked=taskAgents(task),owners=detailSection('关联 Agent','⑂');if(linked.length){const rows=el('div','related-list');for(const agent of linked){const node=button('related-button',undefined,()=>{ui.view='agents';ui.filter='all';ui.project='';ui.query='';$('search').value='';ui.selected={type:'agent',id:agent.id};ui.fromAgent=null;render();});node.append(el('span','',agentName(agent)),badge(agentState(agent)));rows.append(node);}owners.append(rows);}else owners.append(el('p','missing','这项任务尚未绑定到已知 Agent'));fragment.append(owners);
  const evidence=detailSection('产出与证据','↗');appendEvidence(evidence,task.evidence);fragment.append(evidence);
  const checks=detailSection('验收状态','✓'),checksList=el('div','verification');for(const [key,label] of [['sourceReview','源码 / 资料检查'],['deployment','部署 / 交付'],['businessAcceptance','业务验收']]){const check=task.verification?.[key] || {},row=el('div','verification-row'),line=el('div','verification-top');line.append(el('span','',label),el('span','verification-state',config?.verification?.[check.state] || '未核实'));row.append(line);if(check.note)row.append(el('p','verification-note',check.note));checksList.append(row);}checks.append(checksList);fragment.append(checks);
  const details=el('details','more-details');details.open=expandedDetails.has(task.id);details.addEventListener('toggle',()=>{if(details.open)expandedDetails.add(task.id);else expandedDetails.delete(task.id);});details.append(el('summary','','目标与完成标准'));for(const [label,value] of [['目标',task.goal],['完成标准',task.acceptanceCriteria],['留给你的决定',task.retainedDecision]]){details.append(el('h3','',label),el('p','',value || '未记录'));}if(task.state==='paused')details.append(el('p','','保持暂停；此页面不会启动或恢复任务'));fragment.append(details);return fragment;
}
function renderInspector(){const selected=ui.selected&&(ui.selected.type==='agent'?agentById(ui.selected.id):taskById(ui.selected.id));if(!selected){const empty=el('div','inspector-empty');empty.append(el('span','','↖'),el('h2','','选择一条记录'),el('p','','查看任务、等待原因和最近产出'));$('inspector').replaceChildren(empty);return;}$('inspector').replaceChildren(ui.selected.type==='agent'?agentInspector(selected):taskInspector(selected));}
function render(){if(!board)return;preserveFocus(()=>{renderProjects();renderSummary();renderFilters();renderRows();renderInspector();});}
function renderSource(){const imported=formatted(board.importedAt);$('snapshot-mode').textContent=board.source?.mode==='synthetic'?'演示数据 · 非实时':'状态快照 · 非实时';$('source-meta').textContent=`导入于 ${imported} · 重读不会更新观察时间`;$('source-label').textContent=text(board.source?.label,'导入记录');$('coverage').textContent=`${agents().length} 位已知 Agent · ${tasks().length} 项选定任务 · ${text(board.coverage?.scope,'仅包含已导入的部分记录')}`;$('read-at').textContent=`本次读取 ${formatted(board.generatedAt)}（设备当地时间）`;}
function showError(code){const message=code==='no_feed'?'尚未接入状态快照':/schema|invalid|missing/.test(code)?'快照格式暂不受支持':code==='auth'?'登录状态已失效，请重新打开私密看板登录':'暂时无法读取快照';$('notice').className='notice error';$('notice').textContent=board?`${message}。保留上次读取的内容，这些记录尚未更新。`:message;if(!board){$('rows').replaceChildren(emptyState(message,'可以稍后点击“重读快照”再试'));$('source-meta').textContent='没有可用的观察数据';}}
async function refresh(){
  const sequence=++requestId,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);$('refresh').disabled=true;$('refresh').textContent='读取中…';
  try{if(!config){const response=await fetch('/api/config',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error([401,403].includes(response.status)?'auth':'config_unavailable');config=await response.json();}
    const response=await fetch('/api/board',{cache:'no-store',signal:controller.signal});if([401,403].includes(response.status))throw new Error('auth');const result=await response.json();if(sequence!==requestId)return;if(!response.ok)throw new Error(result.error || 'source_unavailable');if(!Array.isArray(result.tasks))throw new Error('invalid_tasks');board=result;$('notice').textContent='';$('notice').className='notice';renderSource();render();observationSignature=freshnessSignature();
  }catch(error){if(sequence===requestId)showError(error.message || 'source_unavailable');}
  finally{clearTimeout(timer);if(sequence===requestId){$('refresh').disabled=false;$('refresh').replaceChildren(el('span','','↻'),document.createTextNode(' 重读快照'));}}
}
$('search').addEventListener('input',()=>{ui.query=$('search').value.trim().toLocaleLowerCase();ui.selected=null;ui.fromAgent=null;render();});
$('project').addEventListener('change',()=>setProject($('project').value));$('refresh').addEventListener('click',refresh);$('view-agents').addEventListener('click',()=>setView('agents'));$('view-tasks').addEventListener('click',()=>setView('tasks'));
function freshnessSignature(){return [...agents().map(agent=>`${agent.id}:${freshness(activity(agent).observedAt)}`),...tasks().map(task=>`${task.id}:${freshness(task.observedAt)}`)].join('|');}
setInterval(()=>{if(!board || document.hidden)return;const next=freshnessSignature();if(next!==observationSignature){observationSignature=next;render();}},60000);
void refresh();
