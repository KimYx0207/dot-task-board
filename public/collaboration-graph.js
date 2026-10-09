// Read-only presentation for dot-board.snapshot/2. No execution or request writes.
const array = value => Array.isArray(value) ? value : [];
const label = (value, fallback = '') => typeof value === 'string' && !/(?:__external_|\/workspace\/|\/user_notes\/|\/agent_notes\/|\/root\/|dream_notes|system\s*prompt)/i.test(value) ? value : fallback;
const STATES = {running:'工作中',waiting:'等待中',blocked:'受阻',paused:'已暂停',idle:'空闲',completed:'本轮完成',unknown:'状态未知'};

export function observationFreshness(value, now, staleAfterMinutes = 120) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || !Number.isFinite(now)) return 'unknown';
  const age = now - time;
  if (age < -300000) return 'clock_error';
  return age > staleAfterMinutes * 60000 ? 'stale' : 'current';
}

export function createCollaborationModel(board, {project = '', now = Date.now(), staleAfterMinutes = 120, visibleAgentIds = null} = {}) {
  const threshold = Number.isFinite(staleAfterMinutes) && staleAfterMinutes > 0 ? staleAfterMinutes : 120;
  const tasks = array(board?.tasks).filter(t => typeof t?.id === 'string');
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const records = array(board?.agents).filter(a => typeof a?.id === 'string');
  // Defensive even though normalized snapshots reject duplicate identities/cycles.
  const counts = new Map();
  for (const a of records) counts.set(a.id, (counts.get(a.id) || 0) + 1);
  const agents = records.filter(a => counts.get(a.id) === 1);
  const byId = new Map(agents.map(a => [a.id, a]));
  const parents = new Map();
  for (const a of agents) {
    if (a.relationshipState === 'known' && a.parentAgentId !== a.id && byId.has(a.parentAgentId)) parents.set(a.id, a.parentAgentId);
  }
  const cyclic = new Set();
  for (const a of agents) {
    const path = [], seen = new Map(); let id = a.id;
    while (id && !seen.has(id)) { seen.set(id, path.length); path.push(id); id = parents.get(id); }
    if (id && seen.has(id)) for (const member of path.slice(seen.get(id))) cyclic.add(member);
  }
  for (const id of cyclic) parents.delete(id);
  const linkedTasks = a => tasks.filter(t => array(a.taskIds).includes(t.id) || array(t.assignedAgentIds).includes(a.id));
  const visible = Array.isArray(visibleAgentIds) ? new Set(visibleAgentIds) : null;
  const direct = new Set(agents.filter(a => (!visible || visible.has(a.id)) && (!project || array(a.projectNames).includes(project) || linkedTasks(a).some(t => t.project === project))).map(a => a.id));
  const included = new Set(direct);
  for (const id of direct) { let parent = parents.get(id); while(parent && !included.has(parent)) { included.add(parent); parent = parents.get(parent); } }
  const nodes = agents.filter(a => included.has(a.id)).map(a => {
    const freshness = observationFreshness(a.activity?.observedAt, now, threshold);
    const state = Object.hasOwn(STATES, a.activity?.state) ? a.activity.state : 'unknown';
    const statusLabel = state === 'running' && freshness !== 'current' ? '上次记录执行' : STATES[state];
    const relation = parents.has(a.id) ? 'known' : a.parentAgentId === null && a.relationshipState === 'known' && a.type === 'agent' ? 'root' : 'unknown';
    return {id:a.id, name:label(a.name,'未命名 Agent'), kind:a.kind, type:a.type === 'subagent' ? 'subagent' : a.type === 'agent' ? 'Agent' : '类型未核实',
      contextOnly:!direct.has(a.id), parentId:parents.get(a.id) || null, relation,
      state, statusLabel, freshness, observedAt:a.activity?.observedAt || null,
      summary:label(a.activity?.summary), latestResult:label(a.latestResult?.summary),
      projects:array(a.projectNames).map(p=>label(p)).filter(Boolean),
      tasks:linkedTasks(a).filter(t => !project || t.project === project).map(t => ({id:t.id,title:label(t.title,'未命名任务')})),
      unresolvedTaskCount: Math.max(Number.isInteger(a.unresolvedTaskCount) ? a.unresolvedTaskCount : 0, array(a.taskIds).filter(id => !taskMap.has(id)).length),
      // Snapshot freshness is never evidence of a live event stream.
      animate:false};
  });
  const ids = new Set(nodes.map(n => n.id));
  const edges = nodes.filter(n => n.parentId && ids.has(n.parentId)).map(n => ({from:n.parentId,to:n.id,kind:'parent',label:'已记录创建关系',animate:false}));
  return {nodes,edges,project:label(project),mode:'snapshot',duplicateCount:[...counts.values()].filter(c=>c>1).length,invalidRelationshipCount:cyclic.size};
}

const palettes = [['#7860d8','#ede8ff'],['#087c87','#ddf6f3'],['#bd6728','#fff0d7'],['#426cdc','#e9efff'],['#bf577e','#ffeaf1']];
export function dotIconURI(kind='worker', index=0) {
  const [color,pale]=palettes[index%palettes.length];
/* Tabler Icons, MIT License, Copyright (c) 2020-2026 Paweł Kuna.
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
Sources: https://github.com/tabler/tabler-icons/tree/main/icons/outline
skull.svg blob 6f90b24499c9c17051e9f8fdc45826c6d0ee2a94
clipboard-text.svg blob a50ef2a7d9d0cf285e5be276f01f5a7c8e8d24f6
flask.svg blob b1f6019197554fbb41696479563214bcd59b666b
check.svg blob 8457c556102d84eb91162fc04bd527eeb883fd62
*/
  const libraryIcons={"skull": "<path d=\"M12 4c4.418 0 8 3.358 8 7.5c0 1.901 -.755 3.637 -2 4.96l0 2.54a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-2.54c-1.245 -1.322 -2 -3.058 -2 -4.96c0 -4.142 3.582 -7.5 8 -7.5\" />\n  <path d=\"M10 17v3\" />\n  <path d=\"M14 17v3\" />\n  <path d=\"M8 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />\n  <path d=\"M14 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />", "clipboard-text": "<path d=\"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2\" />\n  <path d=\"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2\" />\n  <path d=\"M9 12h6\" />\n  <path d=\"M9 16h6\" />", "flask": "<path d=\"M9 3l6 0\" />\n  <path d=\"M10 9l4 0\" />\n  <path d=\"M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6\" />", "check": "<path d=\"M5 12l5 5l10 -10\" />"};
  const iconName=kind==='coordinator'?'skull':kind==='reviewer'?'check':kind==='researcher'?'flask':'clipboard-text';
  const accessory='<g transform="translate(57 54)" fill="none" stroke="#253044" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+libraryIcons[iconName]+'</g>';
  // Project-owned geometric circle, not an embedded third-party brand path.
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88"><circle cx="44" cy="46" r="35" fill="'+pale+'"/><circle cx="44" cy="44" r="19" fill="none" stroke="'+color+'" stroke-width="10"/>'+accessory+'</svg>';
  return 'data:image/svg+xml,'+encodeURIComponent(svg);
}
export function layoutCollaboration(model) {
  const groups=new Map(),roots=[];
  for(const node of model.nodes){if(node.relation==='root')roots.push(node);else {const requested=model.project || array(node.projects)[0];const key=label(requested) || '项目未关联';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}}
  const zones=[],nodes=[],entries=[...groups],cols=Math.min(2,Math.max(1,entries.length)),zoneW=380,gap=28;
  const offset=roots.length?250:24,width=Math.max(240,offset+cols*zoneW+(cols-1)*gap+24);
  const rootHeight=roots.length*320+50;
  if(roots.length){zones.push({name:'总体协调',x:24,y:24,width:198,height:rootHeight,root:true});roots.forEach((n,i)=>nodes.push({...n,x:48,y:86+i*320,colorIndex:0}));}
  let y=24;
  for(let row=0;row<entries.length;row+=cols){const chunk=entries.slice(row,row+cols),height=Math.max(...chunk.map(([,items])=>Math.ceil(items.length/2)*320+82));chunk.forEach(([name,items],col)=>{const x=offset+col*(zoneW+gap);zones.push({name,x,y,width:zoneW,height,root:false,clickable:name!=='项目未关联'&&Boolean(label(name))});items.forEach((n,i)=>nodes.push({...n,x:x+24+(i%2)*178,y:y+62+Math.floor(i/2)*320,colorIndex:[...n.id].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%palettes.length}));});y+=height+28;}
  return {zones,nodes,width,height:Math.max(420,y+12,rootHeight+48)};
}
const viewStates=new WeakMap();
export function renderCollaborationGraph(container, model, {onAgent,onTask,onProject}={}) {
  const doc=container.ownerDocument;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=label(String(text));return n;};
  const btn=(text,run,key)=>{const n=el('button','canvas-control',text);n.type='button';n.dataset.focusKey=key;n.addEventListener('click',run);return n;};
  const state=viewStates.get(container)||{scale:1,tour:false,signature:''};viewStates.set(container,state);
  const shell=el('section','collab-canvas');shell.setAttribute('aria-label','Agent 协作画布');
  const bar=el('div','canvas-toolbar'),heading=el('div','canvas-heading');heading.append(el('strong','','项目与 Agent'),el('span','','点击角色查看任务'));bar.append(heading);
  const controls=el('div','canvas-controls'),zoomLabel=el('output','canvas-zoom','100%');
  const viewport=el('div','canvas-viewport');viewport.tabIndex=0;viewport.setAttribute('aria-label','协作画布，可滚动浏览；使用缩放按钮调整，Tab 选择节点');
  const stage=el('div','canvas-stage'),world=el('div','canvas-world');const layout=layoutCollaboration(model);
  world.style.width=layout.width+'px';world.style.height=layout.height+'px';stage.append(world);viewport.append(stage);
  const apply=()=>{state.scale=Math.min(1.6,Math.max(.25,state.scale));world.style.transform=`scale(${state.scale})`;stage.style.width=layout.width*state.scale+'px';stage.style.height=layout.height*state.scale+'px';zoomLabel.textContent=Math.round(state.scale*100)+'%';};
  const fit=()=>{state.scale=Math.min(1,(viewport.clientWidth-32)/layout.width);apply();viewport.scrollLeft=0;viewport.scrollTop=0;};
  controls.append(btn('−',()=>{state.scale-=.15;apply();},'canvas:out'),zoomLabel,btn('+',()=>{state.scale+=.15;apply();},'canvas:in'),btn('适应画布',fit,'canvas:fit'));
  const tour=btn('导览动效',()=>{state.tour=!state.tour;world.classList.toggle('tour-on',state.tour);tour.setAttribute('aria-pressed',String(state.tour));},'canvas:tour');tour.setAttribute('aria-pressed',String(state.tour));controls.append(tour);bar.append(controls);shell.append(bar);
  const note=el('div','canvas-legend');note.append(el('span','legend-parent','实线：已记录父子关系'),el('span','','分区：项目归属'),el('span','','动效仅作路径导览，不代表正在执行'));shell.append(note);
  for(const zone of layout.zones){const z=el('section','canvas-zone');Object.assign(z.style,{left:zone.x+'px',top:zone.y+'px',width:zone.width+'px',height:zone.height+'px'});const title=typeof onProject==='function'&&!zone.root&&zone.clickable?btn(zone.name,()=>onProject(zone.name),'canvas:project:'+zone.name):el('span','',zone.name);title.classList.add('zone-title');z.append(title);world.append(z);}
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.classList.add('canvas-routes');svg.setAttribute('width',layout.width);svg.setAttribute('height',layout.height);svg.setAttribute('aria-hidden','true');const positioned=new Map(layout.nodes.map(n=>[n.id,n]));
  for(const edge of model.edges){const a=positioned.get(edge.from),b=positioned.get(edge.to);if(!a||!b)continue;const path=doc.createElementNS(ns,'path'),x1=a.x+150,y1=a.y+42,x2=b.x+75,y2=b.y+8,bus=a.relation==='root'?230:a.x+164,routeY=b.y-18;path.setAttribute('d',`M ${x1} ${y1} H ${bus} V ${routeY} H ${x2} V ${y2}`);path.setAttribute('class','canvas-route');path.setAttribute('fill','none');svg.append(path);const hint=doc.createElementNS(ns,'path');hint.setAttribute('d',path.getAttribute('d'));hint.setAttribute('class','canvas-route-tour');hint.setAttribute('fill','none');svg.append(hint);}
  world.append(svg);
  for(const n of layout.nodes){const node=el('article','canvas-node');node.dataset.agentId=n.id;Object.assign(node.style,{left:n.x+'px',top:n.y+'px'});if(n.contextOnly)node.classList.add('context-only');
    const action=btn('',()=>onAgent?.(n.id),'canvas:agent:'+n.id);action.className='canvas-agent';action.setAttribute('aria-label',`${label(n.name,'未命名 Agent')}，${label(n.statusLabel,'状态待核实')}，${n.freshness==='current'?'近期观察':'观察待更新'}，查看详情`);if(!onAgent)action.disabled=true;
    const icon=createRolePortrait(doc,n,'canvas-dot role-portrait');action.append(icon,el('strong','canvas-name',n.name));node.append(action);
    const stale=n.freshness!=='current',status=el('span',`canvas-state ${stale?'state-stale':n.state}`,stale?`${n.statusLabel} · 待更新`:n.statusLabel);node.append(status);if(n.contextOnly)node.append(el('span','canvas-context','父级上下文'));
    if(n.relation==='unknown')node.append(el('span','canvas-context','父级未核实'));
    if(n.tasks.length){const tasks=el('div','canvas-task-links');for(const task of n.tasks.slice(0,2)){const t=btn(task.title,()=>onTask?.(task.id,n.id),'canvas:task:'+JSON.stringify([n.id,task.id]));t.className='canvas-task';t.title=label(task.title);if(!onTask)t.disabled=true;tasks.append(t);}if(n.tasks.length>2)tasks.append(el('span','canvas-context',`另 ${n.tasks.length-2} 项 · 点击节点`));node.append(tasks);}world.append(node);
  }
  if(!model.nodes.length)viewport.append(el('p','canvas-empty','没有符合筛选条件的 Agent；试试其他项目或清空筛选'));
  world.classList.toggle('tour-on',state.tour);shell.append(viewport);container.replaceChildren(shell);apply();
  const signature=model.project+'|'+model.nodes.map(n=>n.id).join(',');if(state.signature!==signature){state.signature=signature;(doc.defaultView?.requestAnimationFrame||globalThis.requestAnimationFrame||((fn)=>fn()))(()=>{state.scale=1;apply();});}
  let drag=null;viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a,input,select'))return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture?.(event.pointerId);});viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft=drag.left-(event.clientX-drag.x);viewport.scrollTop=drag.top-(event.clientY-drag.y);});const stop=()=>{drag=null;};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);
}

// Shared custom character sheet; final coordinates are supplied by the asset owner.
export const ROLE_PORTRAITS = Object.freeze({ready:true,url:'/dot-agent-roles.png',size:'300% 200%',positions:{pirate:'0% 0%',clerk:'50% 0%',repair:'100% 0%',inspector:'0% 100%',researcher:'50% 100%',coordinator:'100% 100%'}});
const kindPortraits=Object.freeze({coordinator:'coordinator',owner:'pirate',worker:'clerk',reviewer:'inspector',researcher:'researcher'});
const portraitKeys=Object.freeze(['pirate','clerk','repair','inspector','researcher','coordinator']);
export function resolvePortraitRole(agent){
 const kind=typeof agent==='string'?agent:agent?.kind;
 if(Object.hasOwn(kindPortraits,kind))return {key:kindPortraits[kind],mode:'role_default',note:'岗位基础装扮 · 个人专属设定未建档'};
 const id=typeof agent?.id==='string'?agent.id:'';
 if(!id)return {key:null,mode:'unassigned',note:'形象未设定'};
 const hash=[...id].reduce((value,ch)=>(Math.imul(value,31)+ch.codePointAt(0))>>>0,0);
 return {key:portraitKeys[hash%portraitKeys.length],mode:'stable_generated',note:'按稳定身份分配的装扮 · 岗位未核实'};
}
export function createRolePortrait(doc,agent,classes='role-portrait'){
 const node=doc.createElement('span');node.className=classes;node.setAttribute('aria-hidden','true');const resolved=resolvePortraitRole(agent);node.title=resolved.note;node.dataset.portraitRole=resolved.key||'unassigned';node.dataset.portraitMode=resolved.mode;
 if(ROLE_PORTRAITS.ready&&resolved.key){node.style.backgroundImage=`url(${ROLE_PORTRAITS.url})`;node.style.backgroundSize=ROLE_PORTRAITS.size;node.style.backgroundPosition=ROLE_PORTRAITS.positions[resolved.key];}
 else{node.textContent='形象未设定';node.classList.add('portrait-pending');}
 return node;
}
