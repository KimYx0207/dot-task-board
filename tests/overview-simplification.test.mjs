import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewCounts, renderProjectClarity, taskExcerpt} from '../public/project-clarity.js';

const now = Date.parse('2026-10-08T11:00:00Z');
const baseTask = (changes = {}) => ({id:'task-a', title:'Alpha task', project:'Alpha', state:'partial', observedAt:'2026-10-08T10:59:00Z', observation:'A verified result.', nextAction:'Review the existing result.', ...changes});
const boardFor = tasks => ({projects:[...new Set(tasks.map(task => task.project))], tasks, agents:[]});
const manual = state => ({source:'owner_manual', version:1, state, reason:'Owner decision'});
const queueFor = (task, changes = {}) => ({enabled:true, jobs:[{id:'check-a', projectId:'alpha', projectName:task.project, originalTaskContext:{taskId:task.id}, state:'running', effectiveState:'running', evidenceType:'tool_result', lastExecutionObservedAt:'2026-10-08T10:59:00Z', evidenceExpiresAt:'2026-10-08T11:04:00Z', observedAt:'2026-10-08T10:59:00Z', ...changes}]});

class Element {
  constructor(tag, doc) { this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.dataset={}; this.attributes={}; this.listeners=new Map(); this.className=''; this.ownText=''; this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>{this.className+=' '+name;}}; }
  set textContent(value) { this.ownText=String(value); this.children=[]; }
  get textContent() { return this.ownText+this.children.map(child=>child.textContent).join(''); }
  append(...children) { for(const child of children) { child.parentElement=this; this.children.push(child); } }
  replaceChildren(...children) { this.children=[]; this.ownText=''; this.append(...children); }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  addEventListener(key,listener) { const callbacks=this.listeners.get(key)||[]; callbacks.push(listener); this.listeners.set(key,callbacks); }
  fire(key) { for(const callback of this.listeners.get(key)||[])callback({target:this}); }
}
const container = () => {const document={createElement:tag=>new Element(tag,document)}; return document.createElement('main');};
const walk = node => [node,...node.children.flatMap(walk)];
const nodes = (node, name) => walk(node).filter(child=>child.classList.contains(name));
const visibleText = node => node.ownText+(node.tagName==='DETAILS'&&!node.open?node.children.slice(0,1):node.children).map(visibleText).join('');
const overviewValue = (root, kind) => Number(nodes(root,'pc-overview-item').find(node=>node.dataset.kind===kind)?.children[0].textContent);

test('overview execution counts require matching, unexpired, typed receipts', () => {
  const task=baseTask({state:'running'}), board=boardFor([task]), before=structuredClone(board);
  assert.equal(overviewCounts(board.tasks,board,null,now).running,0);
  assert.equal(overviewCounts(board.tasks,board,queueFor(task),now).running,1);
  for(const changes of [{effectiveState:undefined},{evidenceType:'started'},{evidenceExpiresAt:null},{evidenceExpiresAt:new Date(now).toISOString()},{lastExecutionObservedAt:new Date(now+1000).toISOString()},{projectId:'validation'},{projectName:'Other'},{originalTaskContext:{taskId:'wrong'}}]) {
    assert.equal(overviewCounts(board.tasks,board,queueFor(task,changes),now).running,0,JSON.stringify(changes));
  }
  assert.equal(overviewCounts(board.tasks,board,{...queueFor(task),enabled:false},now).running,0);
  task.manualStatus=manual('running');
  assert.equal(overviewCounts(board.tasks,board,null,now).running,0);
  delete task.manualStatus;
  assert.deepEqual(board,before);
});

test('overview blocked tally includes explicit blocked labels without optional blocker text', () => {
  const tasks=[baseTask({state:'blocked'}),baseTask({id:'manual-blocked',manualStatus:manual('blocked')}),baseTask({id:'text-blocker',blocker:'Waiting for access'})], board=boardFor(tasks);
  assert.equal(overviewCounts(tasks,board,null,now).blocked,3);
});

test('overview never revives stopped or manually completed tasks from old blockers or active receipts', () => {
  for(const state of ['paused','canceled','completed']) {
    const task=baseTask({blocker:'Historical blocker',observedAt:'2026-10-01T00:00:00Z',manualStatus:manual(state)}), board=boardFor([task]);
    const counts=overviewCounts(board.tasks,board,queueFor(task),now);
    assert.equal(counts.running,0);assert.equal(counts.blocked,0);assert.equal(counts.unverified,0);
    assert.equal(counts.paused,state==='paused'?1:0);assert.equal(counts.completed,state==='completed'?1:0);
  }
  for(const state of ['paused','canceled']) {
    const task=baseTask({state,manualStatus:manual('running')}), board=boardFor([task]);
    assert.equal(overviewCounts(board.tasks,board,queueFor(task),now).running,0);
  }
});

test('overview unverified count covers missing, stale and future source times without refreshing them', () => {
  const tasks=[baseTask(),baseTask({id:'missing',observedAt:null}),baseTask({id:'old',observedAt:'2026-10-01T00:00:00Z'}),baseTask({id:'future',observedAt:'2026-10-08T12:00:00Z'})], board=boardFor(tasks), before=structuredClone(board);
  assert.equal(overviewCounts(tasks,board,null,now).unverified,3);assert.deepEqual(board,before);
});

test('excerpt limits preserve Unicode characters and never mutate original text', () => {
  const text='  已核验🙂\n第二行  ';assert.equal(taskExcerpt(text,4),'已核验🙂…');assert.equal(text,'  已核验🙂\n第二行  ');
  assert.equal(taskExcerpt('1234',4),'1234');assert.equal(taskExcerpt(null),'');assert.equal(taskExcerpt('/workspace/private'), '');
});

test('collapsed task card uses excerpts while full source progress and next step remain expandable', () => {
  const progress='A full progress paragraph.\n'+('More source detail. '.repeat(12)), next='A full bounded next step. '+('Keep all instructions available. '.repeat(8));
  const task=baseTask({observation:progress,nextAction:next,goal:'Original goal',acceptanceCriteria:'Original acceptance'}), board=boardFor([task]), before=structuredClone(board), root=container();
  renderProjectClarity(root,board,null,{now});
  const details=nodes(root,'pc-task-details')[0];assert.equal(details.open,false);
  assert.equal(nodes(root,'pc-progress')[0].parentElement,details);assert.equal(nodes(root,'pc-next')[0].parentElement,details);
  assert.equal(nodes(root,'pc-progress')[0].children[1].textContent,progress);assert.equal(nodes(root,'pc-next')[0].children[1].textContent,next);
  assert(!visibleText(root).includes(progress));assert(!visibleText(root).includes(next));assert(visibleText(root).includes(taskExcerpt(progress)));
  details.open=true;details.fire('toggle');renderProjectClarity(root,board,null,{now});
  assert.equal(nodes(root,'pc-task-details')[0].open,true);assert(visibleText(root).includes(progress));assert(visibleText(root).includes(next));assert(visibleText(root).includes(task.goal));assert.deepEqual(board,before);
});

test('overview matches project, query and displayed manual-state filters and is absent in agent view', () => {
  const tasks=[baseTask({state:'paused'}),baseTask({id:'beta',title:'Beta task',project:'Beta',manualStatus:manual('completed')})], board=boardFor(tasks),root=container();
  renderProjectClarity(root,board,null,{now,project:'Alpha'});assert.equal(overviewValue(root,'paused'),1);assert.equal(overviewValue(root,'completed'),0);
  renderProjectClarity(root,board,null,{now,query:'Beta'});assert.equal(overviewValue(root,'paused'),0);assert.equal(overviewValue(root,'completed'),1);
  renderProjectClarity(root,board,null,{now,taskState:'completed'});assert.equal(overviewValue(root,'paused'),0);assert.equal(overviewValue(root,'completed'),1);
  renderProjectClarity(root,board,null,{now,query:'no-match'});assert.equal(overviewValue(root,'paused'),0);assert.equal(overviewValue(root,'completed'),0);
  renderProjectClarity(root,board,null,{now,contentType:'agents'});assert.equal(nodes(root,'pc-overview').length,0);
});

test('compact stopped arrangements cannot expose historical resume instructions as current next steps', () => {
  for(const state of ['paused','canceled']) {
    const task=baseTask({state,nextAction:'Resume old execution immediately.'}), root=container(),board=boardFor([task]);
    renderProjectClarity(root,board,null,{now});assert(!root.textContent.includes(task.nextAction));assert.match(nodes(root,'pc-next-brief')[0].textContent,/保持暂停|不再继续/);
  }
  const task=baseTask({manualStatus:manual('completed'),blocker:'Old blocker',nextAction:'Old pending instruction'}),root=container();renderProjectClarity(root,boardFor([task]),null,{now});
  assert.match(nodes(root,'pc-next-brief')[0].textContent,/Owner decision/);assert(!visibleText(root).includes(task.nextAction));assert(nodes(root,'pc-history')[0].textContent.includes(task.nextAction));
});
