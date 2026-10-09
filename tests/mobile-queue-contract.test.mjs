import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createQueueControls, moveQueueItem, orderedQueue} from '../public/queue-controls.js';

// A DOM contract harness: use the real renderer and listeners, with no browser,
// third-party dependency, or changes to the project's other test fixtures.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = new Map();
    this.className = '';
    this.disabled = false;
    this.scrollTop = 0;
    this.captured = new Set();
    this.bounds = {top: 0, left: 0, right: 600, bottom: 300, height: 300};
    this.ownText = '';
    this.classList = {
      contains: value => this.className.split(/\s+/).includes(value),
      add: value => { if (!this.classList.contains(value)) this.className += ` ${value}`; },
      remove: value => { this.className = this.className.split(/\s+/).filter(item => item !== value).join(' '); },
    };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML sink'); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { if (this.children.some(child => child.contains(this.ownerDocument.activeElement))) this.ownerDocument.activeElement = this.ownerDocument.body; for (const child of this.children) child.parentElement = null; this.children = []; this.ownText = ''; this.append(...children); }
  contains(node) { return walk(this).includes(node); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, listener) { const listeners = this.events.get(name) ?? []; listeners.push(listener); this.events.set(name, listeners); }
  querySelectorAll(selector) { return walk(this).slice(1).filter(node => selector === '[data-queue-focus]' ? node.dataset.queueFocus !== undefined : selector === '[data-queue-execution-state]' ? node.dataset.queueExecutionState !== undefined : selector === '[data-queue-current-step]' ? node.dataset.queueCurrentStep !== undefined : selector === '[role="status"]' ? node.attributes.role === 'status' : false); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { if (!this.disabled) { this.ownerDocument.activeElement = this; this.ownerDocument.fire('focusin', {target: this}); } }
  getBoundingClientRect() { return this.bounds; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  fire(name, values = {}) {
    const event = {button: 0, pointerId: 1, isPrimary: true, clientX: 50, clientY: 50, ...values,
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    for (const listener of this.events.get(name) ?? []) listener(event);
    return event;
  }
  click() { if (!this.disabled) this.fire('click'); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const tick = () => new Promise(resolve => setImmediate(resolve));
const stamp = '2026-10-07T17:00:00Z';
const job = (id, overrides = {}) => ({
  id, requestId: `request-${id}`, projectId: `project-${id}`, projectName: `Project ${id}`,
  title: `Task ${id}`, state: 'queued', version: 1, priority: 0, holdsSlot: false,
  threadBound: false, environmentType: 'native_cloud', observedAt: stamp,
  lastExecutionObservedAt: null, summary: '', canReorder: true, queueRank: 1,
  reason: 'Waiting for an available slot', ...overrides,
});
const snapshot = (jobs = [job('a'), job('b', {queueRank: 2}), job('c', {queueRank: 3})], overrides = {}) => ({
  enabled: true, capacity: 6, capacityScope: 'configured_per_owner', automaticExecution: false,
  coverage: {scope: 'managed_queue', total: jobs.length, truncated: false}, jobs,
  counts: {heldSlots: jobs.filter(j => j.holdsSlot).length, queued: jobs.filter(j => j.state === 'queued').length, blocked: 0, uncertain: 0, completed: 0},
  ordering: 'priority_desc_created_asc_id_asc', ...overrides,
});
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values};
}
function setup(requestJson, options = {}) {
  const documentEvents = new Map();
  const document = {activeElement: null, createElement: tag => new Element(tag, document),
    addEventListener(name, listener) { const listeners = documentEvents.get(name) ?? new Set(); listeners.add(listener); documentEvents.set(name, listeners); },
    removeEventListener(name, listener) { documentEvents.get(name)?.delete(listener); },
    fire(name, event) { for (const listener of documentEvents.get(name) ?? []) listener(event); },
  };
  document.body = document.createElement('body');
  document.activeElement = document.body;
  const container = document.createElement('section');
  document.body.append(container);
  let uuidCalls = 0;
  const storage = options.storage ?? memoryStorage();
  const control = createQueueControls(container, {requestJson, storage, uuid: () => `event-${++uuidCalls}`, now: () => Date.parse(stamp), ...options});
  return {container, document, storage, control, uuidCalls: () => uuidCalls,
    node: key => walk(container).find(node => node.dataset.queueFocus === key),
    row: id => walk(container).find(node => node.dataset.queueJob === id),
    queueIds: () => walk(container).filter(node => node.tagName === 'LI' && node.dataset.queueJob).map(node => node.dataset.queueJob),
  };
}
const error = status => Object.assign(Error('Request failed'), {status});
function reorderResult(current, body) {
  const items = JSON.parse(body).items;
  return snapshot([
    ...current.jobs.filter(item => item.state !== 'queued'),
    ...items.map(({id, expectedVersion}, index) => ({...current.jobs.find(item => item.id === id), version: expectedVersion + 1, queueRank: index + 1, priority: items.length - index})),
  ]);
}


import {aggregateProjects,renderProjectOverview} from '../public/project-overview.js';
const cls=(root,name)=>walk(root).filter(node=>node.className.split(/\s+/).includes(name));
function mobileDragLayout(h){const list=walk(h.container).find(node=>node.className==='queue-list');list.bounds={top:0,bottom:300,left:0,right:390,height:300};list.children.forEach((row,index)=>{row.bounds={top:index*100,bottom:(index+1)*100,left:0,right:390,height:100};});return list;}

test('independent: registration numbers and record IDs survive inverse-priority reorder and reload',async()=>{
 let current=snapshot([job('old',{taskNumber:70,queueRank:2,priority:1,title:'Same title'}),job('new',{taskNumber:4,queueRank:1,priority:2,title:'Same title'}),job('active',{taskNumber:91,state:'claimed',holdsSlot:true,canReorder:false})]);
 const posts=[];const request=async(_,options)=>{if(options){posts.push(JSON.parse(options.body));current=reorderResult(current,options.body);}return current;};
 const h=setup(request);await h.control.refresh();assert.deepEqual(h.queueIds(),['new','old']);await h.control.move('old',0);assert.deepEqual(h.queueIds(),['old','new']);
 for(const [id,n]of [['old',70],['new',4],['active',91]])assert.match(h.row(id).textContent,new RegExp('登记 #'+n));
 assert.deepEqual(posts[0].items.map(item=>item.id),['old','new']);assert(!posts[0].items.some(item=>Object.hasOwn(item,'taskNumber')));
 const reloaded=setup(request);await reloaded.control.refresh();assert.deepEqual(reloaded.queueIds(),['old','new']);assert.match(reloaded.row('old').textContent,/登记 #70/);h.control.destroy();reloaded.control.destroy();
});

test('independent: missing or invalid registration numbers never inherit list positions',async()=>{
 const entries=[job('a',{taskNumber:0}),job('b',{taskNumber:-3,queueRank:2}),job('c',{taskNumber:NaN,queueRank:3})];const h=setup(async()=>snapshot(entries));await h.control.refresh();assert.doesNotMatch(h.container.textContent,/登记 #/);
 const model=aggregateProjects({projects:['P'],tasks:entries.map(j=>({id:j.id,title:j.title,project:'P',taskNumber:j.taskNumber,state:'queued'})),agents:[]});renderProjectOverview(h.container,model);assert(cls(h.container,'po-task-title').every(node=>!node.textContent.includes('#')));h.control.destroy();
});

test('independent: filter and reordered presentation select original IDs despite identical task titles',()=>{
 const input={projects:['P'],tasks:[{id:'real-70',title:'Same',taskNumber:70,project:'P',state:'queued'},{id:'real-4',title:'Same',taskNumber:4,project:'P',state:'completed'}],agents:[]};const h=setup(async()=>snapshot([])),selected=[];
 renderProjectOverview(h.container,aggregateProjects(input,{taskState:'completed'}),{onTask:id=>selected.push(id)});cls(h.container,'po-task')[0].click();assert.deepEqual(selected,['real-4']);assert.equal(cls(h.container,'po-task-title')[0].textContent,'#4 · Same');h.control.destroy();
});

test('independent: terminal and reserved membership cannot leak into keyboard reorder payload',async()=>{
 const states=['claimed','dispatching','assigned','running','blocked','uncertain','completed','failed','canceled'];let current=snapshot([job('a'),job('b',{queueRank:2}),...states.map(state=>job(state,{state,canReorder:false,holdsSlot:true}))]);const posts=[];
 const h=setup(async(_,options)=>{if(options){posts.push(JSON.parse(options.body));current=reorderResult(current,options.body);}return current;});await h.control.refresh();h.node('handle:b').fire('keydown',{key:'ArrowUp'});await tick();assert.deepEqual(posts[0].items.map(item=>item.id),['b','a']);for(const state of states)assert.equal(h.node('handle:'+state),undefined);h.control.destroy();
});

test('independent: rapid repeated keyboard events cannot create overlapping mutations',async()=>{
 let resolve;const posts=[];const current=snapshot();const h=setup(async(_,options)=>{if(options){posts.push(options);return new Promise(done=>{resolve=done;});}return current;});await h.control.refresh();const old=h.node('handle:a');old.fire('keydown',{key:'ArrowDown'});for(let i=0;i<6;i++)old.fire('keydown',{key:'ArrowDown'});assert.equal(posts.length,1);resolve(reorderResult(current,posts[0].body));await tick();assert.deepEqual(h.queueIds(),['b','a','c']);h.control.destroy();
});

test('independent: dropping outside without an intervening pointermove must not save',async()=>{
 const posts=[];const current=snapshot();const h=setup(async(_,options)=>{if(options){posts.push(options);return reorderResult(current,options.body);}return current;});await h.control.refresh();mobileDragLayout(h);const handle=h.node('handle:a');handle.fire('pointerdown',{pointerId:9,pointerType:'touch',clientX:20,clientY:50});handle.fire('pointermove',{pointerId:9,pointerType:'touch',clientX:20,clientY:280});handle.fire('pointerup',{pointerId:9,pointerType:'touch',clientX:800,clientY:280});await tick();h.control.destroy();assert.equal(posts.length,0,'release outside 390px list should cancel, not use previous inside sample');
});

test('independent: unrelated pointer cancellation cannot cancel the captured touch',async()=>{
 const posts=[];const current=snapshot();const h=setup(async(_,options)=>{if(options){posts.push(options);return reorderResult(current,options.body);}return current;});await h.control.refresh();mobileDragLayout(h);const handle=h.node('handle:a');handle.fire('pointerdown',{pointerId:9,pointerType:'touch'});handle.fire('pointermove',{pointerId:9,clientY:280});handle.fire('pointercancel',{pointerId:10,pointerType:'touch'});const captured=handle.hasPointerCapture(9);handle.fire('pointerup',{pointerId:9,clientY:280});await tick();h.control.destroy();assert.equal(captured,true,'cancel for pointer 10 must not release pointer 9');assert.equal(posts.length,1);
});

test('independent: mobile CSS retains explicit queue hit-target and one-column request contracts',()=>{
 const queue=readFileSync(new URL('../public/queue-controls.css',import.meta.url),'utf8'),styles=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8'),project=readFileSync(new URL('../public/project-overview.css',import.meta.url),'utf8');
 assert.match(queue,/@media\(max-width:700px\)[\s\S]*?\.queue-order-buttons \.queue-button,\.queue-handle\{min-height:44px;min-width:44px\}/);assert.match(queue,/touch-action:none/);assert.match(styles,/\.request-grid\{grid-template-columns:1fr\}/);assert.match(project,/\.project-overview\[data-content-type=tasks\] \.po-task-row\{grid-template-columns:minmax\(0,1fr\) auto\}/);
});
