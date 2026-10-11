// Ordinary candidate intake only. Approval stores a received request, never execution.
const array = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value : '';
const STORAGE_KEY = 'dot-board-candidate-draft-v1';
export const CANDIDATE_STATUS = {proposed:'待你审批',approved:'已批准 · 需求已保存',rejected:'已拒绝'};
export function candidateReadsAvailable(config) {return config?.candidateCapabilities != null ? config.candidateCapabilities.storageAvailable === true : config?.candidatesEnabled === true;}
const clone = value => JSON.parse(JSON.stringify(value));
const blankDraft = () => ({projectId:'',contextTaskId:'',title:'',reason:'',expectedOutcome:'',area:'',dueAt:'',sourceKind:'reference',sourceLabel:'',sourceReference:''});
export function candidateValid(candidate) {
  return candidate && typeof candidate.id === 'string' && typeof candidate.clientSubmissionId === 'string' && typeof candidate.projectId === 'string' &&
    typeof candidate.title === 'string' && typeof candidate.reason === 'string' && typeof candidate.expectedOutcome === 'string' &&
    Object.hasOwn(CANDIDATE_STATUS,candidate.status) && Number.isSafeInteger(candidate.version) && candidate.version > 0 &&
    array(candidate.sourceReferences).length > 0 && candidate.sourceReferences.every(ref => ref && ['kind','label','reference'].every(key => typeof ref[key] === 'string'));
}
export function safeReferenceUrl(reference) {
  try {const url=new URL(reference);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password ? url.href : null;} catch {return null;}
}
function createMatches(candidate,payload) {
  return candidateValid(candidate) && ['clientSubmissionId','projectId','title','reason','expectedOutcome','viewedSnapshotRevision','viewedSnapshotImportedAt'].every(key=>candidate[key]===payload[key]) &&
    (candidate.contextTaskId||null)===(payload.contextTaskId||null) && (candidate.dueAt||null)===(payload.dueAt||null) && (candidate.area||'')===(payload.area||'') &&
    JSON.stringify(candidate.sourceReferences)===JSON.stringify(payload.sourceReferences);
}
function reviewMatches(candidate,payload) {
  return candidateValid(candidate) && candidate.version > payload.expectedVersion && candidate.review?.eventId===payload.eventId && candidate.review.decision===payload.decision && candidate.review.note===payload.note && candidate.status===(payload.decision==='approve'?'approved':'rejected') && (payload.decision!=='approve'||Boolean(candidate.requestId));
}
export function createCandidateController({requestJson,supported=()=>true,capabilities=()=>({canPropose:true,canReview:true}),snapshot=()=>({}),storage=null,uuid=()=>globalThis.crypto?.randomUUID?.(),onChange=()=>{},onSaved=()=>{}}={}) {
  const state={records:[],nextCursor:null,loading:false,loaded:false,error:'',selectedId:null,details:new Map(),draft:blankDraft(),pendingCreate:null,creating:false,checkingCreate:false,createError:'',createMessage:'',createMessageCandidateId:null,composerOpen:false,storageWarning:false,reviewNotes:new Map(),reviews:new Map(),filter:'proposed'};
  function notify(){try{onChange(state);}catch{ /* View failures cannot invalidate a confirmed receipt. */ }}
  function persist(){if(!storage)return;try{storage.setItem(STORAGE_KEY,JSON.stringify({draft:state.draft,pendingCreate:state.pendingCreate,reviews:[...state.reviews].filter(([,entry])=>entry.pending).map(([id,entry])=>[id,{pending:entry.pending,note:state.reviewNotes.get(id)||''}])}));state.storageWarning=false;}catch{state.storageWarning=true;}}
  try {const saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');if(saved&&typeof saved==='object'){if(saved.draft&&typeof saved.draft==='object')for(const key of Object.keys(state.draft))if(typeof saved.draft[key]==='string')state.draft[key]=saved.draft[key];if(saved.pendingCreate?.clientSubmissionId&&typeof saved.pendingCreate.projectId==='string'){state.pendingCreate=saved.pendingCreate;state.composerOpen=true;}for(const item of array(saved.reviews)){if(Array.isArray(item)&&typeof item[0]==='string'&&item[1]?.pending?.eventId){state.reviews.set(item[0],{pending:item[1].pending,saving:false,error:'',message:''});state.reviewNotes.set(item[0],string(item[1].note));}}}}catch{state.storageWarning=true;}
  const reviewState=id=>{if(!state.reviews.has(id))state.reviews.set(id,{pending:null,saving:false,error:'',message:''});return state.reviews.get(id);};
  function adopt(candidate){if(candidate.id===state.createMessageCandidateId&&candidate.status!=='proposed')state.createMessage='';const old=state.records.find(item=>item.id===candidate.id);if(old&&old.version>candidate.version)return;state.records=[candidate,...state.records.filter(item=>item.id!==candidate.id)].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
  function confirmCreate(candidate){if(!state.pendingCreate||!createMatches(candidate,state.pendingCreate))return false;adopt(candidate);state.pendingCreate=null;state.draft=blankDraft();state.selectedId=candidate.id;state.createError='';state.createMessage=candidate.status==='proposed'?'候选已保存，等待你的审批。尚未生成执行任务。':'';state.createMessageCandidateId=candidate.id;state.composerOpen=false;persist();return true;}
  function confirmReview(candidate){const entry=reviewState(candidate.id);if(!entry.pending||!reviewMatches(candidate,entry.pending))return false;entry.pending=null;entry.error='';entry.message=candidate.status==='approved'?'已批准并保存需求。实际处理请查看回执；审批没有启动执行。':'已记录拒绝决定。';persist();try{onSaved(candidate);}catch{}return true;}
  async function refresh({more=false}={}) {
    if(!supported()||state.loading||more&&!state.nextCursor)return;
    const cursor=more?state.nextCursor:null;state.loading=true;state.error='';notify();
    try{const value=await requestJson('/api/candidates'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(value.candidates)||!value.candidates.every(candidateValid))throw Error('invalid_response');const previous=new Map(state.records.map(item=>[item.id,item]));if(!more)state.records=[];for(const item of value.candidates){const known=previous.get(item.id);adopt(known&&known.version>item.version?known:item);confirmCreate(item);confirmReview(item);}state.nextCursor=typeof value.nextCursor==='string'?value.nextCursor:null;state.loaded=true;}
    catch(error){state.error=[401,403].includes(error.status)?'登录状态不可用，请重新登录后读取候选。':'暂时无法读取候选，保留上次成功读取的内容。';}
    finally{state.loading=false;notify();}
  }
  async function select(id,{force=false,preserveSelection=false}={}) {
    if(!supported())return;if(!preserveSelection)state.selectedId=id;const old=state.details.get(id);if(old?.loading){notify();return;}if(old?.loaded&&!force){notify();return;}
    const entry={...old,loading:true,error:'',loaded:false};state.details.set(id,entry);notify();
    try {const value=await requestJson('/api/candidates/'+encodeURIComponent(id));if(!candidateValid(value.candidate)||value.candidate.id!==id)throw Error('invalid_response');const known=state.records.find(item=>item.id===id);if(known&&known.version>value.candidate.version){entry.candidate=known;entry.request=null;entry.error='读取到较早的版本，请重新读取详情后再决定。';}else{entry.candidate=value.candidate;entry.request=value.request||null;entry.loaded=true;adopt(value.candidate);confirmReview(value.candidate);confirmCreate(value.candidate);}}
    catch(error){entry.error=error.status===404?'候选不存在或当前账户无权读取。':'读取详情失败，原有内容已保留。请重新读取后再审批。';}
    finally{entry.loading=false;notify();}
  }
  function edit(field,value){if(state.pendingCreate||state.creating||!Object.hasOwn(state.draft,field))return;state.draft[field]=string(value);if(field==='projectId')state.draft.contextTaskId='';state.createError='';state.createMessage='';persist();notify();}
  async function propose() {
    if(!supported()||capabilities().canPropose!==true||state.creating||state.pendingCreate)return;
    const draft=state.draft,snap=snapshot();
    if(!draft.projectId||!draft.title.trim()||!draft.reason.trim()||!draft.expectedOutcome.trim()||!draft.sourceReference.trim()||!draft.sourceLabel.trim()){state.createError='请填写项目、标题、理由、预期结果和来源。';notify();return;}
    if(!snap.snapshotRevision||!snap.importedAt){state.createError='当前快照尚未读取，请先更新进展。';notify();return;}
    const id=uuid();if(!id){state.createError='当前浏览器无法生成安全提交标识，请保留文字后更新浏览器。';notify();return;}
    const dueAt=draft.dueAt?new Date(/Z$/.test(draft.dueAt)?draft.dueAt:draft.dueAt+'Z'):null;if(dueAt&&!Number.isFinite(dueAt.getTime())){state.createError='截止时间格式无效。';notify();return;}
    const payload={clientSubmissionId:id,projectId:draft.projectId,contextTaskId:draft.contextTaskId||null,title:draft.title.trim(),reason:draft.reason.trim(),expectedOutcome:draft.expectedOutcome.trim(),sourceReferences:[{kind:draft.sourceKind.trim()||'reference',label:draft.sourceLabel.trim(),reference:draft.sourceReference.trim()}],area:draft.area.trim(),dueAt:dueAt?.toISOString()||null,viewedSnapshotRevision:snap.snapshotRevision,viewedSnapshotImportedAt:snap.importedAt};
    state.pendingCreate=clone(payload);state.creating=true;state.createError='';persist();notify();
    try {const value=await requestJson('/api/candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!createMatches(value.candidate,payload))throw Error('invalid_response');confirmCreate(value.candidate);state.details.set(value.candidate.id,{candidate:value.candidate,loaded:true,loading:false,error:''});}
    catch(error){const definitive=error.status>=400&&error.status<500&&![408,409,429].includes(error.status);if(definitive){state.pendingCreate=null;persist();state.createError='候选未保存，请检查填写内容或登录状态后再试。';}else state.createError='保存回执尚未确认。原文和提交标识已保留，请回读核对，避免重复提交。';}
    finally{state.creating=false;notify();}
  }
  async function reconcileCreate(){if(!state.pendingCreate||state.creating||!supported())return;const payload=state.pendingCreate;state.creating=true;state.checkingCreate=true;state.createError='';notify();try{const value=await requestJson('/api/candidates?clientSubmissionId='+encodeURIComponent(payload.clientSubmissionId));if(!Array.isArray(value.candidates)||!value.candidates.every(candidateValid))throw Error('invalid_response');const match=value.candidates.find(item=>createMatches(item,payload));if(match){confirmCreate(match);state.details.set(match.id,{candidate:match,loaded:true,loading:false,error:''});}else state.createError='服务器尚未返回这条候选的保存记录。原文与标识继续保留；稍后再回读核对。';}catch{state.createError='回读失败，保存结果仍未确认。原文和提交标识继续保留。';}finally{state.creating=false;state.checkingCreate=false;notify();}}
  async function review(id,decision) {
    const detail=state.details.get(id),candidate=detail?.candidate,entry=reviewState(id);
    if(!supported()||capabilities().canReview!==true||entry.pending||entry.saving||!detail?.loaded||detail.loading||candidate?.status!=='proposed'||!['approve','reject'].includes(decision))return;
    const eventId=uuid();if(!eventId){entry.error='无法生成安全审批标识，请更新浏览器。';notify();return;}
    const payload={eventId,expectedVersion:candidate.version,decision,note:string(state.reviewNotes.get(id)).trim()};entry.pending=clone(payload);entry.saving=true;entry.error='';entry.message='';persist();notify();
    try{const value=await requestJson('/api/candidates/'+encodeURIComponent(id)+'/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!candidateValid(value.candidate)||value.candidate.id!==id||!reviewMatches(value.candidate,payload))throw Error('invalid_response');adopt(value.candidate);detail.candidate=value.candidate;detail.request=value.request||null;confirmReview(value.candidate);}
    catch(error){if(error.status===409&&['candidate_version_conflict','candidate_already_reviewed'].includes(error.message)){entry.pending=null;detail.loaded=false;persist();entry.error='候选已发生变化，正在重新读取。请查看最新决定，不会覆盖他人的审批。';await select(id,{force:true,preserveSelection:true});}else if(error.status>=400&&error.status<500&&![408,409,429].includes(error.status)){entry.pending=null;persist();entry.error='审批未保存，请检查当前登录状态后重新读取。';detail.loaded=false;}else entry.error='审批回执尚未确认。决定和标识已保留，请回读核对；不会重复提交。';}
    finally{entry.saving=false;notify();}
  }
  function note(id,value){const entry=reviewState(id);if(entry.pending||entry.saving)return;state.reviewNotes.set(id,string(value));notify();}
  return {getState:()=>state,refresh,select,edit,propose,reconcileCreate,review,note,reviewState,setFilter:value=>{state.filter=Object.hasOwn(CANDIDATE_STATUS,value)?value:'all';notify();},toggleComposer:()=>{state.composerOpen=!state.composerOpen;notify();}};
}

function node(doc,tag,className,value){const element=doc.createElement(tag);if(className)element.className=className;if(value!==undefined)element.textContent=String(value);return element;}
function action(doc,label,run,className='cw-button'){const element=node(doc,'button',className,label);element.type='button';element.addEventListener('click',run);return element;}
function field(doc,label,control){const wrap=node(doc,'label','cw-field');wrap.append(node(doc,'span','cw-label',label),control);return wrap;}
function time(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(date)+' UTC':'未记录';}
export function renderCandidateWorkspace(container,controller,{enabled=false,capabilities={},projects=[],tasks=[],onOpenRequest=()=>{},onOpenTask=()=>{}}={}) {
  const doc=container.ownerDocument,state=controller.getState(),fragment=node(doc,'div','cw-workspace');
  const intro=node(doc,'div','cw-intro');intro.append(node(doc,'p','cw-muted','批准只保存需求，实际执行另需授权。'));
  const actions=node(doc,'div','cw-actions');const reload=action(doc,state.loading?'读取中…':'更新候选',()=>void controller.refresh());reload.disabled=!enabled||state.loading;const add=action(doc,state.composerOpen?'收起表单':'＋ 录入候选',()=>controller.toggleComposer(),'cw-button');add.disabled=!enabled||capabilities.canPropose!==true;add.setAttribute('aria-expanded',String(state.composerOpen));actions.append(reload,add);intro.append(actions);fragment.append(intro);
  if(!enabled){const empty=node(doc,'div','cw-disabled');empty.append(node(doc,'h3','','候选审批尚未接通'),node(doc,'p','','项目和已有任务仍可查看。配置候选存储后，即可保留来源并审批；这不依赖 Sites 直接执行 Events。'));fragment.append(empty);container.replaceChildren(fragment);return;}
  if(state.storageWarning)fragment.append(node(doc,'p','cw-alert','浏览器暂不能跨刷新保留草稿和待核对标识，请先保留文字并核对回执。'));
  if(state.composerOpen||state.pendingCreate)fragment.append(renderComposer(doc,controller,{projects,tasks}));
  if(state.createMessage)fragment.append(node(doc,'p','cw-success',state.createMessage));
  const layout=node(doc,'div','cw-layout'),listPane=node(doc,'section','cw-list-pane'),heading=node(doc,'div','cw-list-heading');heading.append(node(doc,'h3','','候选清单'),node(doc,'span','cw-count',state.loaded?`${state.records.filter(item=>item.status==='proposed').length} 条待审批${state.nextCursor?' · 当前页':''}`:'尚未读取'));
  listPane.append(heading);const filters=node(doc,'div','cw-filters');for(const [value,label]of [['proposed','待审批'],['approved','已批准'],['rejected','已拒绝'],['all','全部']]){const button=action(doc,label,()=>controller.setFilter(value),'cw-filter');button.setAttribute('aria-pressed',String(state.filter===value));button.dataset.focusKey='candidate-filter:'+value;filters.append(button);}listPane.append(filters);
  const readStatus=node(doc,'p',state.error?'cw-alert':'cw-muted',state.error||(state.loading?'正在读取候选记录…':''));readStatus.setAttribute('role','status');listPane.append(readStatus);
  const visible=state.records.filter(item=>state.filter==='all'||item.status===state.filter),list=node(doc,'div','cw-list');
  for(const candidate of visible){const row=action(doc,'',()=>void controller.select(candidate.id),'cw-candidate');row.dataset.focusKey='candidate:'+candidate.id;row.setAttribute('aria-pressed',String(state.selectedId===candidate.id));const top=node(doc,'div','cw-card-top');top.append(node(doc,'span','cw-card-date',candidate.dueAt?'截止 '+time(candidate.dueAt):time(candidate.createdAt)));row.append(top,node(doc,'strong','cw-card-title',candidate.title),node(doc,'span','cw-card-project',projects.find(project=>project.id===candidate.projectId)?.displayName||projects.find(project=>project.id===candidate.projectId)?.name||candidate.projectId));list.append(row);}
  if(!visible.length)list.append(node(doc,'p','cw-empty',state.loaded?(state.nextCursor?'当前已读取记录中没有这一类，加载更多继续查看。':'这个分类还没有候选。录入有来源的建议后，在这里审批。'):'读取后显示候选；空列表不代表已经处理完。'));listPane.append(list);
  if(state.nextCursor){const more=action(doc,'加载更多候选',()=>void controller.refresh({more:true}));more.disabled=state.loading;listPane.append(more);}layout.append(listPane);
  const detail=node(doc,'section','cw-detail');detail.setAttribute('aria-label','候选详情');detail.setAttribute('tabindex','-1');detail.dataset.focusKey='candidate-detail';
  if(!state.selectedId){const empty=node(doc,'div','cw-detail-empty');empty.append(node(doc,'span','cw-empty-mark','◎'),node(doc,'h3','','选择一条候选'),node(doc,'p','','先看来源和预期结果，再决定是否保存成需求。'));detail.append(empty);}else renderDetail(detail,controller,{projects,tasks,capabilities,onOpenRequest,onOpenTask});
  layout.append(detail);fragment.append(layout);container.replaceChildren(fragment);
}
function renderComposer(doc,controller,{projects,tasks}){
  const state=controller.getState(),draft=state.draft,locked=state.creating||Boolean(state.pendingCreate),form=node(doc,'form','cw-composer');form.setAttribute('aria-label','录入候选');form.addEventListener('submit',event=>{event.preventDefault();void controller.propose();});form.append(node(doc,'h3','','录入一条有来源的候选'));
  const grid=node(doc,'div','cw-form-grid');const select=node(doc,'select');const empty=node(doc,'option','','选择项目');empty.value='';select.append(empty);for(const project of projects.filter(item=>item.id)){const option=node(doc,'option','',project.displayName||project.name);option.value=project.id;select.append(option);}select.value=draft.projectId;select.disabled=locked;select.dataset.focusKey='candidate-draft:projectId';select.addEventListener('change',()=>controller.edit('projectId',select.value));grid.append(field(doc,'所属项目',select));
  const context=node(doc,'select');const none=node(doc,'option','','项目整体，不关联任务');none.value='';context.append(none);const project=projects.find(item=>item.id===draft.projectId);for(const task of tasks.filter(item=>item.projectId===draft.projectId||array(project?.taskIds).includes(item.id))){const option=node(doc,'option','',task.title);option.value=task.id;context.append(option);}context.value=draft.contextTaskId;context.disabled=locked||!draft.projectId;context.dataset.focusKey='candidate-draft:contextTaskId';context.addEventListener('change',()=>controller.edit('contextTaskId',context.value));grid.append(field(doc,'关联任务（可选）',context));
  for(const [key,label,max,multiline]of [['title','候选标题',200,false],['reason','为什么值得做',1600,true],['expectedOutcome','预期得到什么',1600,true],['sourceLabel','来源名称',120,false],['sourceReference','原始来源链接或引用',1800,true],['area','领域 / 上下文（可选）',100,false],['dueAt','截止时间（可选，UTC）',30,false]]){const input=node(doc,multiline?'textarea':'input');input.value=draft[key];input.maxLength=max;input.disabled=locked;input.dataset.focusKey='candidate-draft:'+key;if(multiline)input.rows=key==='sourceReference'?2:3;if(key==='dueAt')input.type='datetime-local';input.addEventListener('input',()=>controller.edit(key,input.value));const wrap=field(doc,label,input);if(['title','reason','expectedOutcome','sourceReference'].includes(key))wrap.className+=' cw-span';grid.append(wrap);}form.append(grid);
  const message=node(doc,'p',state.createError?'cw-alert':'cw-muted',state.createError||(state.pendingCreate?'保存结果待核对，原文和标识已锁定。':'表单只录入候选。批准与实际执行是独立步骤。'));message.setAttribute('role','status');form.append(message);
  const submit=node(doc,'button','cw-button cw-primary',state.creating?(state.checkingCreate?'正在回读核对…':'正在保存候选…'):state.pendingCreate?'回读核对保存结果':'保存候选');submit.type=state.pendingCreate?'button':'submit';submit.disabled=state.creating;if(state.pendingCreate)submit.addEventListener('click',()=>void controller.reconcileCreate());form.append(submit);return form;
}
const candidateDisclosures=new WeakMap();
function candidateDisclosure(doc,controller,key,label,className) {
  const states=candidateDisclosures.get(controller)||new Set();candidateDisclosures.set(controller,states);
  const details=node(doc,'details',className),summary=node(doc,'summary','',label);summary.dataset.focusKey=key;
  details.open=states.has(key);details.addEventListener('toggle',()=>details.open?states.add(key):states.delete(key));details.append(summary);return details;
}
function renderDetail(detail,controller,{projects,tasks,capabilities,onOpenRequest,onOpenTask}) {
  const doc=detail.ownerDocument,state=controller.getState(),id=state.selectedId,entry=state.details.get(id),candidate=entry?.candidate||state.records.find(item=>item.id===id),review=controller.reviewState(id);
  const top=node(doc,'div','cw-detail-top');top.append(node(doc,'span','workspace-kicker','候选详情'));const reread=action(doc,entry?.loading?'读取中…':'更新详情',()=>void controller.select(id,{force:true}));reread.dataset.focusKey='candidate-reread:'+id;reread.disabled=entry?.loading||review.saving;top.append(reread);detail.append(top);
  if(entry?.loading)detail.append(node(doc,'p','cw-muted','正在读取详情，读取完成前不能审批。'));if(entry?.error)detail.append(node(doc,'p','cw-alert',entry.error));if(!candidate)return;
  detail.append(node(doc,'h3','cw-detail-title',candidate.title),node(doc,'span','cw-status',CANDIDATE_STATUS[candidate.status]));
  for(const [label,value]of [['建议理由',candidate.reason],['预期结果',candidate.expectedOutcome]]){const section=node(doc,'section','cw-detail-section');section.append(node(doc,'h4','',label),node(doc,'p','',value));detail.append(section);}
  if(candidate.contextStale)detail.append(node(doc,'p','cw-alert','项目已有更新，请展开来源与上下文核对后再决定。'));
  if(candidate.review){const decision=node(doc,'section','cw-decision-record');decision.append(node(doc,'h4','','你的决定'),node(doc,'p','',candidate.review.note||'未填写决定备注'),node(doc,'p','cw-muted',time(candidate.review.reviewedAt)));detail.append(decision);}
  if(candidate.status==='approved'){detail.append(node(doc,'p','cw-success','需求已保存；保存回执不代表执行已开始。'));if(candidate.requestId)detail.append(action(doc,'查看保存需求与处理回执',()=>onOpenRequest({id:candidate.requestId,projectId:candidate.projectId}),'cw-button'));}
  if(review.error||review.message){const status=node(doc,'p',review.error?'cw-alert':'cw-success',review.error||review.message);status.setAttribute('role','status');detail.append(status);}
  if(review.pending){const pending=node(doc,'div','cw-pending');pending.append(node(doc,'p','','审批保存结果待核对。原决定与事件标识已保留。'));const check=action(doc,entry?.loading?'正在回读…':'回读核对审批结果',()=>void controller.select(id,{force:true}),'cw-button cw-primary');check.disabled=review.saving||entry?.loading;pending.append(check);detail.append(pending);}
  else if(candidate.status==='proposed'){
    const notes=candidateDisclosure(doc,controller,'candidate-note-panel:'+id,'决定备注（可选）','cw-review-note'),input=node(doc,'textarea');input.rows=2;input.maxLength=1200;input.value=state.reviewNotes.get(id)||'';input.dataset.focusKey='candidate-note:'+id;input.disabled=review.saving||entry?.loading;input.addEventListener('input',()=>controller.note(id,input.value));notes.append(field(doc,'决定备注',input));detail.append(notes);
    const controls=node(doc,'div','cw-review-actions');const approve=action(doc,review.saving?'正在保存决定…':'批准并保存需求',()=>void controller.review(id,'approve'),'cw-button cw-primary'),reject=action(doc,'拒绝',()=>void controller.review(id,'reject'),'cw-button');approve.disabled=reject.disabled=review.saving||entry?.loading||!entry?.loaded||capabilities.canReview!==true;approve.dataset.focusKey='candidate-approve:'+id;reject.dataset.focusKey='candidate-reject:'+id;controls.append(approve,reject);detail.append(controls);
  }
  const context=candidateDisclosure(doc,controller,'candidate-context:'+id,'来源与上下文','cw-context-details');
  const pairs=node(doc,'dl','cw-metadata');for(const [label,value] of [['项目',projects.find(item=>item.id===candidate.projectId)?.displayName||projects.find(item=>item.id===candidate.projectId)?.name||candidate.projectId],['领域 / 上下文',candidate.area||'未填写'],['截止时间',candidate.dueAt?time(candidate.dueAt):'未设置'],['录入时间',time(candidate.createdAt)],['版本',String(candidate.version)]])pairs.append(node(doc,'dt','',label),node(doc,'dd','',value));context.append(pairs);
  if(candidate.contextTaskId){const task=tasks.find(item=>item.id===candidate.contextTaskId);if(task)context.append(action(doc,'关联任务：'+task.title,()=>onOpenTask(task.id),'cw-context-link'));else context.append(node(doc,'p','cw-muted','关联任务：'+candidate.contextTaskId+'（不在当前快照中）'));}
  const sources=node(doc,'section','cw-detail-section');sources.append(node(doc,'h4','','原始来源'));for(const reference of candidate.sourceReferences){const source=node(doc,'div','cw-source');source.append(node(doc,'span','cw-source-kind',reference.kind));const href=safeReferenceUrl(reference.reference);if(href){const link=node(doc,'a','',reference.label||'打开原始来源');link.href=href;link.target='_blank';link.rel='noopener noreferrer';source.append(link,node(doc,'p','cw-source-reference',reference.reference));}else source.append(node(doc,'strong','',reference.label),node(doc,'p','cw-source-reference',reference.reference));sources.append(source);}context.append(sources);
  const snapshot=node(doc,'section','cw-snapshot');snapshot.append(node(doc,'h4','','引用快照'),node(doc,'p','',candidate.viewedSnapshotRevision||'未记录'),node(doc,'p','',time(candidate.viewedSnapshotImportedAt)));context.append(snapshot,node(doc,'p','cw-decision-note','批准仅创建状态为「已收到」的需求，不入执行队列，也不调用 Events。'));detail.append(context);
}
