// Read-only projections for navigation. Original records and execution controls stay intact.
import {taskClarity,utcTime} from './project-clarity.js';
import {safeReferenceUrl,candidateReadsAvailable} from './candidate-workspace.js';
const list=value=>Array.isArray(value)?value:[];
const safe=value=>typeof value==='string'&&!/(?:__external_|\/workspace\/|\/user_notes\/|\/agent_notes\/|\/root\/|dream_notes|system\s*prompt)/i.test(value)?value:'';
function dom(container){const doc=container.ownerDocument;const el=(tag,cls='',value)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=safe(String(value));return node;};const button=(label,run,key)=>{const node=el('button','wv-link',label);node.type='button';node.dataset.focusKey=key;node.addEventListener('click',run);return node;};return {el,button};}
export function workspaceTasks(board,{project='',query='',taskState='all',queue=null}={}) {
  return list(board?.tasks).filter(task=>!project||task.project===project).map(task=>taskClarity(task,board,queue)).filter(item=>(taskState==='all'||item.displayState===taskState)&&(!query||[item.task.title,item.task.project,item.progress,item.next].map(safe).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
}
export function resultEntries(board,{project=''}={}) {
  const entries=[];
  for(const task of list(board?.tasks).filter(item=>!project||item.project===project)){
    const evidence=list(task.evidence).filter(item=>typeof item?.url==='string'&&safeReferenceUrl(item.url));
    if(evidence.length)entries.push({id:'task:'+task.id,taskId:task.id,title:safe(task.title),project:safe(task.project),summary:safe(task.observation),observedAt:task.observedAt,evidence,kind:'任务证据'});
  }
  for(const agent of list(board?.agents).filter(item=>!project||list(item.projectNames).includes(project))){
    const evidence=list(agent.latestResult?.evidence).filter(item=>typeof item?.url==='string'&&safeReferenceUrl(item.url));
    if(evidence.length)entries.push({id:'agent:'+agent.id,agentId:agent.id,title:safe(agent.name)+' · 最近产出',project:list(agent.projectNames).map(safe).filter(Boolean).join('、'),summary:safe(agent.latestResult.summary),observedAt:agent.latestResult.observedAt,evidence,kind:'负责人产出记录'});
  }
  return entries;
}
export function renderTaskWorkspace(container,board,queue,{project='',query='',taskState='all',onTask=()=>{}}={}) {
  const {el,button}=dom(container),items=workspaceTasks(board,{project,query,taskState,queue}),root=el('section','wv-task-workspace');const heading=el('div','wv-section-heading');heading.append(el('div','',`${items.length} 项任务`),el('span','wv-muted','查看进展、卡点与下一步；执行状态以真实回执为准'));root.append(heading);
  if(!items.length)root.append(el('p','wv-empty','当前范围没有匹配的任务。可以切换项目或清除筛选。'));
  for(const item of items){const task=item.task,row=el('article','wv-task-row'),identity=el('div','wv-task-identity');identity.append(el('span','wv-project-label',task.project||'未分组'),button(`${task.taskNumber?'#'+task.taskNumber+' · ':''}${task.title}`,()=>onTask(task.id),'workspace-task:'+task.id));const state=el('span','wv-task-status',item.status+(item.manual?' · 手动':''));state.dataset.state=item.displayState;identity.append(state);row.append(identity);
    const progress=el('div','wv-task-progress');progress.append(el('span','wv-field-label','最近进展'),el('p','',item.progress),el('span','wv-muted',utcTime(task.observedAt)));const next=el('div','wv-task-next');next.append(el('span','wv-field-label',item.stopped||item.manualCompleted?'当前安排':'下一步'),el('p','',item.next));if(item.blocker&&!item.stopped)next.append(el('p','wv-blocker',item.blocker));row.append(progress,next);root.append(row);
  }container.replaceChildren(root);
}
export function renderResultsWorkspace(container,board,{project='',onTask=()=>{},onAgent=()=>{}}={}) {
  const {el,button}=dom(container),entries=resultEntries(board,{project}),root=el('section','wv-results-workspace');const intro=el('div','wv-results-intro');intro.append(el('p','workspace-kicker','留下可核对的交付'),el('h2','','成果与原始记录'),el('p','wv-muted','这里汇总已记录的证据链接。打开原任务可继续查看需求版本、成果注记和各项验收；有链接不等于项目已验收。'));root.append(intro);
  const count=el('p','wv-result-count',`${entries.length} 组已记录链接`);root.append(count);
  if(!entries.length){const empty=el('div','wv-empty');empty.append(el('h3','','这个范围还没有可打开的成果链接'),el('p','','任务与负责人记录仍保留在项目中；没有原始 URL 时，不会拼接或猜测会话地址。'));root.append(empty);}
  for(const entry of entries){const article=el('article','wv-result'),head=el('div','wv-result-heading'),copy=el('div');copy.append(el('span','wv-project-label',entry.project),el('h3','',entry.title));head.append(copy,button(entry.taskId?'查看原任务':'查看负责人记录',()=>entry.taskId?onTask(entry.taskId):onAgent(entry.agentId),'workspace-result:'+entry.id));article.append(head);if(entry.summary)article.append(el('p','wv-result-summary',entry.summary));article.append(el('p','wv-muted',entry.kind+' · '+utcTime(entry.observedAt)));
    const links=el('div','wv-evidence-links');for(const ref of entry.evidence){const link=el('a','wv-evidence-link',ref.label||'打开已记录的来源');link.href=safeReferenceUrl(ref.url);link.target='_blank';link.rel='noopener noreferrer';links.append(link);}article.append(links);root.append(article);
  }container.replaceChildren(root);
}
export function renderCapabilityState(container,{config=null,intake=null}={}) {
  const {el}=dom(container),root=el('details','workspace-capabilities'),summary=el('summary');summary.append(el('span','capability-dot'),el('strong','','能力与连接'),el('span','capability-summary','Sites 直接执行未接通'));root.append(summary);
  const grid=el('div','capability-grid');for(const [name,state,note]of [
    ['需求与回执',intake?.storageAvailable?'存储已接通':intake?'尚未接通':'正在核验','保存、dot 读取和实际处理分别记录。'],
    ['候选审批',candidateReadsAvailable(config)?(config?.candidateCapabilities?.canReview===false?'可读取 · 审批暂不可用':'候选存储已启用'):config?'尚未启用':'正在核验','已有候选可独立回读；批准只保存 received 需求，不启动执行。'],
    ['Sites 直接 Events 执行','未接通','不影响普通需求回执或候选存储。队列及自动接续仍须独立授权、接入与验收。']]){const item=el('div','capability-item');item.append(el('h3','',name),el('strong','',state),el('p','',note));grid.append(item);}root.append(grid);container.replaceChildren(root);
}

// Only explicit human decisions belong above the project work. Ordinary saved/read
// requests stay in the demand history; a blocked task alone is not an approval.
export function decisionProjectId(projects, selectedName='') {
  if(!selectedName)return null;
  const matches=list(projects).filter(item=>list(item.names).includes(selectedName));
  return matches.length===1&&typeof matches[0].id==='string'&&matches[0].id?matches[0].id:'';
}
export function workspaceDecisions({inbox=null,candidates=null,candidateEnabled=false,projectId=null}={}) {
  const inProject=item=>projectId===null||item.projectId===projectId;
  return {
    requests:list(inbox?.requests).filter(item=>item.status==='needs_confirmation'&&inProject(item)),
    candidates:candidateEnabled?list(candidates?.records).filter(item=>item.status==='proposed'&&inProject(item)):[],
    candidatePartial:Boolean(candidateEnabled&&candidates?.nextCursor),
    requestPartial:Boolean(inbox?.nextCursor)
  };
}
const decisionDisclosure=new WeakMap();
export function renderWorkspaceDecisions(container,{onRequest=()=>{},onCandidates=()=>{},onRequestHistory=()=>{},onRetryRequests=()=>{},onRetryCandidates=()=>{},inboxError='',inboxLoading=false,...data}={}) {
  const {el,button}=dom(container),decisions=workspaceDecisions(data),count=decisions.requests.length+decisions.candidates.length;
  const candidateError=data.candidateEnabled&&data.candidates?.error,readError=Boolean(inboxError||candidateError);
  container.hidden=!count&&!decisions.candidatePartial&&!decisions.requestPartial&&!readError;if(container.hidden){container.replaceChildren();return;}
  const root=el('div','workspace-decisions'),heading=el('h2','',count?'需要你决定':readError?'待决定记录暂不可用':'还有记录待查看');root.append(heading);
  const entries=el('div','workspace-decision-items');
  if(decisions.candidates.length)entries.append(button(`${decisions.candidates.length} 项候选待审批${decisions.candidatePartial?' · 还有记录待查看':''}`,onCandidates,'decisions:candidates'));
  else if(decisions.candidatePartial)entries.append(button('查看其余候选记录',onCandidates,'decisions:candidates'));
  if(decisions.requestPartial)entries.append(button('查看其余需求记录',onRequestHistory,'decisions:request-history'));
  const row=request=>{const item=el('div','workspace-decision-row'),body=Array.from(safe(request.body)||'查看待确认需求'),label=body.slice(0,90).join('')+(body.length>90?'…':'');item.append(button(label,()=>onRequest(request),'decisions:request:'+request.id),el('span','wv-muted',safe(request.projectName)));return item;};
  for(const request of decisions.requests.slice(0,2))entries.append(row(request));
  if(decisions.requests.length>2){const more=el('details','workspace-decision-more'),summary=el('summary','',`另外 ${decisions.requests.length-2} 项待确认`);summary.dataset.focusKey='decisions:more';more.open=decisionDisclosure.get(container)===true;more.addEventListener('toggle',()=>decisionDisclosure.set(container,more.open));more.append(summary,...decisions.requests.slice(2).map(row));entries.append(more);}
  if(inboxError){const retry=button(inboxLoading?'读取中…':'重试读取需求',onRetryRequests,'decisions:retry-requests');retry.disabled=inboxLoading;entries.append(retry);}
  if(candidateError){const retry=button(data.candidates.loading?'读取中…':'重试读取候选',onRetryCandidates,'decisions:retry-candidates');retry.disabled=data.candidates.loading;entries.append(retry);}
  root.append(entries);
  if(inboxError&&(decisions.requests.length||decisions.requestPartial)||data.candidates?.error&&(decisions.candidates.length||decisions.candidatePartial))root.append(el('p','wv-muted','暂时无法更新，以上保留上次读取的待决定事项。'));
  container.replaceChildren(root);
}
