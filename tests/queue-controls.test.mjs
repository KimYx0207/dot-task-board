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
    this.style = {};
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
  querySelectorAll(selector) { return walk(this).slice(1).filter(node => selector === '[data-queue-focus]' ? node.dataset.queueFocus !== undefined : selector === '[data-queue-execution-state]' ? node.dataset.queueExecutionState !== undefined : selector === '[data-queue-project-current]' ? node.dataset.queueProjectCurrent !== undefined : selector === '[data-queue-current-step]' ? node.dataset.queueCurrentStep !== undefined : selector === '[role="status"]' ? node.attributes.role === 'status' : false); }
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

test('real projects precede separately collapsed historical dispatch records on this private Site', () => {
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert(html.indexOf('id="workspace"')<html.indexOf('id="managed-queue"'));
  assert(html.indexOf('id="observation-panel"')<html.indexOf('id="managed-queue"'));
  assert(html.indexOf('id="observation-panel"')<html.indexOf('class="view-toolbar"'));
  assert.match(html,/<details id="observation-panel" class="observation-panel" open>/);
  assert.equal((html.match(/id="managed-queue"/g)??[]).length,1);
  assert(app.includes("createQueueControls($('managed-queue'),{requestJson,"));
  for(const id of ['request-project','request-context-task','request-body','inspector'])assert(html.includes(`id="${id}"`));
  const css=readFileSync(new URL('../public/queue-controls.css',import.meta.url),'utf8');assert.match(css,/min-height:44px;min-width:44px/);assert.match(css,/touch-action:none/);
});

test('render separates global queue, reserved work and stale running evidence without fake live data', async () => {
  const current = snapshot([
    job('running', {state: 'running', canReorder: false, holdsSlot: true, threadBound: true, lastExecutionObservedAt: '2026-10-06T17:00:00Z'}),
    job('reserved', {state: 'claimed', canReorder: false, holdsSlot: true}),
    job('blocked', {state: 'blocked', canReorder: false}),
    job('queued'), job('complete', {state: 'completed', canReorder: false}),
  ]);
  const h = setup(async () => current);
  await h.control.refresh();
  assert.match(h.container.textContent, /所有项目/);
  assert.match(h.container.textContent, /跨项目，不随项目筛选变化/);
  assert.match(h.container.textContent, /容量 6/);
  assert.match(h.container.textContent, /协调者认领执行/);
  assert.match(h.row('running').textContent, /当前执行状态未知 · 证据已过期或缺失/);
  assert.match(h.row('running').textContent, /队列记录.+最近执行证据/);
  assert.match(h.row('running').textContent, /已占用名额，不能拖动/);
  assert.match(h.row('queued').textContent, /Project queued.+尚未分派/);
  assert.match(h.row('queued').textContent, /顺序 \/ 等待原因：Waiting for an available slot/);
  assert.deepEqual(h.queueIds(), ['queued']);
  for (const id of ['running', 'reserved', 'blocked', 'complete']) assert.equal(h.node(`handle:${id}`), undefined);
  assert.equal(h.container.querySelector('[role="status"]').getAttribute('aria-live'), 'polite');
});

test('disabled and empty queues explain their scope without invented task rows', async () => {
  for (const current of [{enabled: false, reason: 'dispatch_disabled', jobs: [], coverage: {scope: 'managed_queue', total: 0, truncated: false}}, snapshot([])]) {
    const h = setup(async () => current);
    await h.control.refresh();
    assert.deepEqual(h.queueIds(), []);
    assert.equal(walk(h.container).filter(node => node.dataset.queueJob).length, 0);
    assert.match(h.container.textContent, current.enabled ? /队列还没有任务/ : /尚未接入执行队列/);
  }
});

test('source values remain plain text and private identity strings do not enter rendered content', async () => {
  const current = snapshot([job('a', {title: '<img src=x onerror=alert(1)>', projectName: '/workspace/private-project', summary: '__external_private_owner', reason: '/user_notes/secret'})]);
  const h = setup(async () => current);
  await h.control.refresh();
  assert(h.container.textContent.includes('<img src=x onerror=alert(1)>'));
  assert(!h.container.textContent.includes('/workspace/'));
  assert(!h.container.textContent.includes('__external_'));
  assert(!h.container.textContent.includes('/user_notes/'));
  assert.equal(walk(h.container).filter(node => ['IMG', 'SCRIPT'].includes(node.tagName)).length, 0);
});

test('keyboard button reorders every queued project with versions, persists server order and leaves running work alone', async () => {
  let current = snapshot([job('a'), job('b', {queueRank: 2, version: 8}), job('running', {state: 'running', canReorder: false, holdsSlot: true})]);
  const calls = [];
  const requestJson = async (url, options) => { calls.push({url, options}); if (options) current = reorderResult(current, options.body); return current; };
  const h = setup(requestJson);
  await h.control.refresh();
  h.node('up:b').click();
  await tick();
  const post = calls.find(call => call.options);
  assert.equal(post.url, '/api/dispatch/reorder');
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post.options.body), {eventId: 'event-1', items: [{id: 'b', expectedVersion: 8}, {id: 'a', expectedVersion: 1}]});
  assert.deepEqual(h.queueIds(), ['b', 'a']);
  assert.equal(h.control.getState().pending, null);
  assert.equal(h.storage.values.size, 0);
  assert.equal(h.row('running').tagName, 'ARTICLE');
  assert.match(h.container.textContent, /排队顺序已保存/);
  const reloaded = setup(requestJson, {storage: h.storage});
  await reloaded.control.refresh();
  assert.deepEqual(reloaded.queueIds(), ['b', 'a']);
});

test('arrow keys use the same persisted reorder flow; edge moves and unrelated keys make no requests', async () => {
  let current = snapshot();
  const posts = [];
  const h = setup(async (_, options) => { if (options) { posts.push(options); current = reorderResult(current, options.body); } return current; });
  await h.control.refresh();
  const handle = h.node('handle:a');
  assert.equal(handle.fire('keydown', {key: 'ArrowUp'}).defaultPrevented, true);
  assert.equal(handle.fire('keydown', {key: 'x'}).defaultPrevented, false);
  await tick();
  assert.equal(posts.length, 0);
  assert.equal(handle.fire('keydown', {key: 'ArrowDown'}).defaultPrevented, true);
  await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(h.queueIds(), ['b', 'a', 'c']);
});

test('keyboard handle focus survives node removal and the disabled saving render', async () => {
  const current = snapshot();
  let finishSave;
  const h = setup(async (_, options) => options ? new Promise(resolve => { finishSave = () => resolve(reorderResult(current, options.body)); }) : current);
  await h.control.refresh();
  const original = h.node('handle:a');
  original.focus();
  original.fire('keydown', {key: 'ArrowDown'});
  assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.node('handle:a').disabled, true);
  assert.notEqual(h.node('handle:a'), original);
  finishSave();
  await tick();
  assert.equal(h.document.activeElement, h.node('handle:a'));
  assert.equal(h.document.activeElement.disabled, false);
});

test('button focus returns after save, with the same task handle as fallback at a queue boundary', async () => {
  for (const [key, expected] of [['down:a', 'down:a'], ['up:b', 'handle:b']]) {
    let current = snapshot();
    const h = setup(async (_, options) => { if (options) current = reorderResult(current, options.body); return current; });
    await h.control.refresh();
    h.node(key).focus();
    h.node(key).click();
    await tick();
    assert.equal(h.document.activeElement, h.node(expected));
  }
});

test('queue refresh retains the focused handle or refresh button across its loading render', async () => {
  for (const key of ['handle:b', 'refresh']) {
    let reads = 0, finishRead;
    const h = setup(async () => ++reads === 1 ? snapshot() : new Promise(resolve => { finishRead = resolve; }));
    await h.control.refresh();
    h.node(key).focus();
    const reading = h.control.refresh();
    assert.equal(h.document.activeElement, h.document.body);
    assert.equal(h.node(key).disabled, true);
    finishRead(snapshot());
    await reading;
    assert.equal(h.document.activeElement, h.node(key));
  }
});

test('save and refresh never reclaim focus after the user moves outside, even if focus returns to the body', async () => {
  for (const operation of ['save', 'refresh']) for (const blurAfter of [false, true]) {
    let reads = 0, finish;
    const current = snapshot();
    const h = setup(async (_, options) => {
      if (options) return new Promise(resolve => { finish = () => resolve(reorderResult(current, options.body)); });
      if (++reads === 1) return current;
      return new Promise(resolve => { finish = () => resolve(current); });
    });
    await h.control.refresh();
    h.node('handle:a').focus();
    const waiting = operation === 'save' ? h.control.move('a', 1) : h.control.refresh();
    const outside = h.document.createElement('input');
    // A coincidentally matching data attribute elsewhere is not this queue's focus.
    outside.dataset.queueFocus = 'handle:b';
    h.document.body.append(outside);
    outside.focus();
    if (blurAfter) h.document.activeElement = h.document.body;
    finish();
    await waiting;
    assert.equal(h.document.activeElement, blurAfter ? h.document.body : outside, `${operation}, blur ${blurAfter}`);
  }
});

test('conflict read preserves the focus intention until queue controls become usable again', async () => {
  let reads = 0;
  const h = setup(async (_, options) => { if (options) throw error(409); reads++; return snapshot(); });
  await h.control.refresh();
  h.node('handle:b').focus();
  await h.control.move('b', 0);
  assert.equal(reads, 2);
  assert.equal(h.document.activeElement, h.node('handle:b'));
});

test('truncated completed history preserves sortable complete queued coverage', async () => {
  const h = setup(async () => snapshot(undefined, {coverage: {scope: 'managed_queue', total: 900, truncated: true, queuedComplete: true}}));
  await h.control.refresh();
  assert.equal(h.control.getState().canSort, true);
  assert.equal(h.node('handle:a').disabled, false);
  assert.match(h.container.textContent, /已显示全部待执行任务，可调整顺序/);
  assert.match(h.container.textContent, /部分历史记录未展开/);
});

function layoutDrag(h) {
  const list = walk(h.container).find(node => node.className === 'queue-list');
  list.bounds = {top: 0, bottom: 300, left: 0, right: 600, height: 300};
  list.children.forEach((row, index) => { row.bounds = {top: index * 100, bottom: (index + 1) * 100, left: 0, right: 600, height: 100}; });
  return list;
}
test('native touch pointer drag changes real queue order only at release and blocks canvas propagation', async () => {
  let current = snapshot();
  const posts = [];
  const h = setup(async (_, options) => { if (options) { posts.push(options); current = reorderResult(current, options.body); } return current; });
  await h.control.refresh();
  const list = layoutDrag(h), handle = h.node('handle:a');
  const down = handle.fire('pointerdown', {pointerType: 'touch'});
  assert(down.defaultPrevented && down.propagationStopped);
  assert(handle.hasPointerCapture(1));
  const move = handle.fire('pointermove', {clientY: 280, pointerType: 'touch'});
  assert(move.defaultPrevented && move.propagationStopped);
  assert.equal(posts.length, 0);
  assert(list.children[2].classList.contains('queue-drop-after'));
  assert.match(h.container.querySelector('[role="status"]').textContent, /第 3 位/);
  assert(h.container.querySelector('[role="status"]').classList.contains('queue-drag-announcement'));
  handle.fire('pointerup', {clientY: 280, pointerType: 'touch'});
  await tick();
  assert.equal(handle.hasPointerCapture(1), false);
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body).items.map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(h.queueIds(), ['b', 'c', 'a']);
});

test('canceled drag, wrong pointer, click, outside drop and Escape never submit a reorder', async () => {
  let posts = 0;
  const h = setup(async (_, options) => { if (options) posts++; return snapshot(); });
  await h.control.refresh();
  for (const finish of ['pointercancel', 'escape', 'outside', 'click', 'lostpointercapture', 'wrongpointer']) {
    layoutDrag(h);
    const handle = h.node('handle:a');
    handle.fire('pointerdown');
    if (finish !== 'click') handle.fire('pointermove', {clientY: 280});
    if (finish === 'escape') handle.fire('keydown', {key: 'Escape'});
    else if (finish === 'outside') { handle.fire('pointermove', {clientX: 900, clientY: 280}); handle.fire('pointerup', {clientX: 900, clientY: 280}); }
    else if (finish === 'click') handle.fire('pointerup');
    else if (finish === 'wrongpointer') { handle.fire('pointerup', {pointerId: 2}); handle.fire('pointercancel'); }
    else handle.fire(finish);
    await tick();
  }
  assert.equal(posts, 0);
  assert.deepEqual(h.queueIds(), ['a', 'b', 'c']);
});

test('pending network response locks controls and repeated clicks cannot create overlapping writes', async () => {
  const current = snapshot();
  let resolvePost;
  const posts = [];
  const h = setup(async (_, options) => { if (!options) return current; posts.push(options); return new Promise(resolve => { resolvePost = resolve; }); });
  await h.control.refresh();
  const saving = h.control.move('c', 0);
  assert.equal(h.control.getState().saving, true);
  assert.equal(h.control.getState().canSort, false);
  assert(h.storage.values.size > 0);
  assert.match(h.container.textContent, /正在保存排队顺序/);
  h.node('down:a').click();
  await h.control.move('b', 0);
  await h.control.retry();
  await h.control.refresh();
  assert.equal(posts.length, 1);
  resolvePost(reorderResult(current, posts[0].body));
  await saving;
  assert.equal(h.control.getState().canSort, true);
});

test('unknown save outcome survives refresh and retries byte-identical event and payload before a new sort', async () => {
  let current = snapshot();
  let failed = false;
  const posts = [];
  const requestJson = async (_, options) => {
    if (!options) return current;
    posts.push(options);
    if (!failed) { failed = true; current = reorderResult(current, options.body); throw Error('Reply lost after commit'); }
    return {...current, replayed: true};
  };
  const h = setup(requestJson);
  await h.control.refresh();
  await h.control.move('c', 0);
  assert.match(h.container.textContent, /保存结果待核对/);
  assert.equal(h.control.getState().canSort, false);
  assert.equal(h.uuidCalls(), 1);
  assert.equal(h.storage.values.size, 1);
  await h.control.move('b', 0);
  assert.equal(posts.length, 1);
  h.control.destroy();
  const restored = setup(requestJson, {storage: h.storage});
  assert.match(restored.container.textContent, /上次排序的保存结果待核对/);
  await restored.control.refresh();
  assert.deepEqual(restored.queueIds(), ['c', 'a', 'b']);
  assert.equal(restored.node('handle:b').disabled, true);
  restored.node('retry').click();
  await tick();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body, posts[0].body);
  assert.equal(restored.uuidCalls(), 0);
  assert.equal(restored.control.getState().pending, null);
  assert.equal(restored.storage.values.size, 0);
  assert.equal(restored.control.getState().canSort, true);
});

test('409 refreshes changed membership without reapplying stale order, then permits a deliberate new move', async () => {
  const before = snapshot();
  const changed = snapshot([job('b', {version: 3}), job('new', {queueRank: 2}), job('a', {queueRank: 3}), job('c', {state: 'claimed', canReorder: false, holdsSlot: true})]);
  let reads = 0;
  const posts = [];
  const h = setup(async (_, options) => {
    if (!options) return ++reads === 1 ? before : changed;
    posts.push(options);
    if (posts.length === 1) throw error(409);
    return reorderResult(changed, options.body);
  });
  await h.control.refresh();
  await h.control.move('c', 0);
  assert.equal(reads, 2);
  assert.equal(posts.length, 1);
  assert.equal(h.control.getState().pending, null);
  assert.deepEqual(h.queueIds(), ['b', 'new', 'a']);
  assert.match(h.container.textContent, /队列已变化/);
  assert.match(h.container.textContent, /核对后重新调整/);
  await h.control.move('a', 0);
  assert.deepEqual(JSON.parse(posts[1].body), {eventId: 'event-2', items: [{id: 'a', expectedVersion: 1}, {id: 'b', expectedVersion: 3}, {id: 'new', expectedVersion: 1}]});
});

test('failed conflict refresh retains last observation but locks sorting until a successful read', async () => {
  let reads = 0;
  const h = setup(async (_, options) => { if (options) throw error(409); if (++reads === 2) throw Error('offline'); return snapshot(); });
  await h.control.refresh();
  await h.control.move('b', 0);
  assert.deepEqual(h.queueIds(), ['a', 'b', 'c']);
  assert.equal(h.control.getState().canSort, false);
  assert.match(h.container.textContent, /尚未读到新顺序/);
  await h.control.refresh();
  assert.equal(h.control.getState().canSort, true);
});

test('ambiguous errors retain retry while definitive rejection clears it and requires a fresh read', async () => {
  for (const status of [408, 429, 500, 401, 403, 422]) {
    const h = setup(async (_, options) => { if (options) throw error(status); return snapshot(); });
    await h.control.refresh();
    await h.control.move('b', 0);
    const ambiguous = [408, 429, 500].includes(status);
    assert.equal(Boolean(h.control.getState().pending), ambiguous, `status ${status}`);
    assert.equal(Boolean(h.node('retry')), ambiguous);
    assert.equal(h.control.getState().canSort, false);
    await h.control.refresh();
    assert.equal(h.control.getState().canSort, !ambiguous);
  }
});

test('malformed save response remains uncertain; incomplete or unsafe queue snapshots disable sorting', async () => {
  const h = setup(async (_, options) => options ? {enabled: true, jobs: []} : snapshot());
  await h.control.refresh();
  await h.control.move('b', 0);
  assert(h.control.getState().pending);
  assert.match(h.container.textContent, /保存结果待核对/);
  const variants = [
    snapshot(undefined, {coverage: {scope: 'managed_queue', total: 4, truncated: true}}),
    snapshot(undefined, {coverage: {scope: 'managed_queue', total: 9, truncated: false}}),
    snapshot([job('a', {holdsSlot: true}), job('b', {queueRank: 2})]),
    snapshot([job('a', {canReorder: false}), job('b', {queueRank: 2})]),
    snapshot([job('a'), job('a')]),
  ];
  for (const current of variants) {
    const view = setup(async () => current);
    await view.control.refresh();
    assert.equal(view.control.getState().canSort, false);
    assert(walk(view.container).filter(node => node.className === 'queue-handle').every(node => node.disabled));
  }
});

test('refresh does not race a drag, and stale pending GET cannot overwrite a retried mutation', async () => {
  let readCount = 0, resolveRead;
  const current = snapshot();
  const h = setup(async (_, options) => {
    if (options) throw Error('transport uncertain');
    if (++readCount === 2) return new Promise(resolve => { resolveRead = resolve; });
    return current;
  });
  await h.control.refresh();
  layoutDrag(h);
  h.node('handle:a').fire('pointerdown');
  await h.control.refresh();
  assert.equal(readCount, 1);
  h.node('handle:a').fire('pointercancel');
  await h.control.move('b', 0);
  const refreshing = h.control.refresh();
  await h.control.retry();
  resolveRead(snapshot([job('obsolete')]));
  await refreshing;
  assert.deepEqual(h.queueIds(), ['a', 'b', 'c']);
  assert(h.control.getState().pending);
  assert.equal(h.control.getState().loading, false);
});

test('unavailable storage warns before refresh and invalid saved payload cannot be replayed', async () => {
  const brokenStorage = {getItem: () => null, setItem: () => { throw Error('storage blocked'); }, removeItem: () => {}};
  const h = setup(async (_, options) => { if (options) throw Error('network'); return snapshot(); }, {storage: brokenStorage});
  await h.control.refresh();
  await h.control.move('b', 0);
  assert.match(h.container.textContent, /不能跨刷新保留待核对请求/);
  const malformed = memoryStorage({'dot-board-queue-reorder-v1': JSON.stringify({eventId: 'x', items: [{id: 'a', expectedVersion: 1}, {id: 'a', expectedVersion: 1}]})});
  const restored = setup(async () => snapshot(), {storage: malformed});
  assert.equal(restored.control.getState().pending, null);
  assert.equal(malformed.values.size, 0);
});

test('destroyed controller ignores late reads and does not update detached UI', async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  const reading = h.control.refresh();
  const before = h.container.textContent;
  h.control.destroy();
  resolve(snapshot());
  await reading;
  assert.equal(h.container.textContent, before);
  assert.equal(h.control.getState().snapshot, null);
});

test('queue ordering helpers preserve source data and clamp only the desired queued position', () => {
  const current = snapshot([job('a', {queueRank: 3}), job('b', {queueRank: 1}), job('c', {queueRank: 2}), job('running', {state: 'running'})]);
  assert.deepEqual(orderedQueue(current).map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(current.jobs.map(item => item.id), ['a', 'b', 'c', 'running']);
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveQueueItem(ids, 'b', 99), ['a', 'c', 'b']);
  assert.deepEqual(moveQueueItem(ids, 'b', -10), ['b', 'a', 'c']);
  assert.deepEqual(moveQueueItem(ids, 'missing', 0), ids);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('evidence expiry changes cached running to unknown, preserves reservation, stable task number and original timestamp', async () => {
  let instant=Date.parse(stamp),reads=0;
  const expires=new Date(instant+60000).toISOString(),current=snapshot([job('working',{state:'running',effectiveState:'running',lifecycleState:'running',holdsSlot:true,canReorder:false,taskNumber:17,threadBound:true,currentStep:'Inspecting the test result',lastEffectiveAction:'Inspected a test result',lastExecutionObservedAt:stamp,evidenceType:'active_process',evidenceExpiresAt:expires}),job('a',{taskNumber:22}),job('b',{taskNumber:11,queueRank:2})]);
  const original=structuredClone(current),h=setup(async()=>{reads++;return current;},{now:()=>instant});
  await h.control.refresh();
  assert.match(h.row('working').textContent,/#17/);assert.match(h.row('working').textContent,/有效证据：执行中/);assert.match(h.row('working').textContent,/当前步骤：Inspecting/);
  h.node('handle:a').focus();instant+=60000;h.control.age();
  assert.equal(reads,1);assert.match(h.row('working').textContent,/当前执行状态未知/);assert(!h.row('working').textContent.includes('当前步骤：'));
  assert.match(h.row('working').textContent,/最近有效动作：Inspected/);assert.match(h.row('working').textContent,/已占用名额，不能拖动/);
  assert.equal(h.document.activeElement,h.node('handle:a'));assert.deepEqual(current,original);
  assert.equal(h.control.getState().snapshot.jobs[0].lastExecutionObservedAt,stamp);
  assert.equal(h.control.getState().snapshot.jobs[0].taskNumber,17);
});

test('evidence aging never interrupts queue drag or save and does not replay a reorder', async () => {
  let instant=Date.parse(stamp),finishSave;const posts=[];
  let current=snapshot([job('working',{state:'running',effectiveState:'running',lifecycleState:'running',holdsSlot:true,canReorder:false,lastExecutionObservedAt:stamp,evidenceType:'tool_result',evidenceExpiresAt:new Date(instant+1000).toISOString()}),job('a',{taskNumber:22}),job('b',{taskNumber:11,queueRank:2})]);
  const h=setup(async(_,options)=>{if(!options)return current;posts.push(options);return new Promise(resolve=>{finishSave=()=>{current=reorderResult(current,options.body);resolve(current);};});},{now:()=>instant});
  await h.control.refresh();layoutDrag(h);const handle=h.node('handle:a');handle.fire('pointerdown');instant+=1000;h.control.age();assert.equal(h.node('handle:a'),handle);assert(handle.hasPointerCapture(1));assert.match(h.row('working').textContent,/当前执行状态未知/);handle.fire('pointercancel');
  const saving=h.control.move('b',0);h.control.age();assert.equal(posts.length,1);finishSave();await saving;
  assert.deepEqual(h.queueIds(),['b','a']);assert.match(h.row('b').textContent,/#11/);assert.match(h.row('a').textContent,/#22/);assert.match(h.row('working').textContent,/当前执行状态未知/);
});

test('visible page ages execution evidence independently of reads and refreshes without replacing the intake form',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert(app.includes('setInterval(ageVisibleEvidence,1000)'));assert(app.includes("document.addEventListener('visibilitychange',ageVisibleEvidence)"));
  const aging=app.slice(app.indexOf('function ageVisibleEvidence()'),app.indexOf('setInterval(ageVisibleEvidence'));
  assert(aging.includes('dispatchQueue.age()'));assert(aging.includes('freshnessSignature()'));assert(aging.includes(".po-viewport.is-dragging"));assert(!aging.includes('renderIntake()'));assert(!aging.includes('fetch('));
});


test('compact rows keep full prose hidden until a stable-ID detail action',async()=>{
 const title='A very long task title which must stay understandable in the list without displaying the whole request\nDetailed acceptance criteria';
 const h=setup(async()=>snapshot([job('a',{title,taskNumber:41,summary:'Full progress narrative'})]));await h.control.refresh();
 const details=()=>walk(h.row('a')).find(node=>node.className==='queue-job-detail');
 assert.equal(details().hidden,true);assert.equal(h.node('detail:a').getAttribute('aria-expanded'),'false');
 assert.equal(h.node('detail:a').title,title);assert(h.node('detail:a').textContent.length<title.length);assert(details().textContent.includes('Full progress narrative'));
 h.node('detail:a').click();assert.equal(details().hidden,false);assert.equal(h.node('detail:a').getAttribute('aria-expanded'),'true');
 await h.control.refresh();assert.equal(details().hidden,false);h.node('detail:a').click();assert.equal(details().hidden,true);
 assert.equal(h.control.getState().snapshot.jobs[0].title,title);
});

test('verified Agent context opens source identities; a thread binding alone never names an Agent',async()=>{
 const calls=[],agent={id:'real-agent',name:'Review worker',kind:'reviewer'};
 const h=setup(async()=>snapshot([job('a',{threadBound:true,taskNumber:8}),job('b',{threadBound:true,queueRank:2})]),{getTaskContext:job=>job.id==='a'?{id:'dispatch:a',agents:[agent]}:null,onOpenAgent:id=>calls.push(['agent',id]),onOpenTask:id=>calls.push(['task',id])});await h.control.refresh();
 assert(h.row('a').textContent.includes('Review worker'));assert(h.row('b').textContent.includes('Agent 未关联'));assert(!h.row('b').textContent.includes('负责人：已绑定'));
 h.node('agent:a:real-agent').click();h.node('context:a').click();assert.deepEqual(calls,[['agent','real-agent'],['task','dispatch:a']]);
});

test('project emphasis never filters the globally reorderable membership',async()=>{
 const h=setup(async()=>snapshot(),{getHighlightedProject:()=> 'Project b'});await h.control.refresh();
 assert.deepEqual(h.queueIds(),['a','b','c']);assert(h.row('b').classList.contains('is-project-highlighted'));assert(!h.row('a').classList.contains('is-project-highlighted'));assert(h.control.getState().canSort);
});

test('snapshot hook receives a detached copy and repaint does not read or persist',async()=>{
 let reads=0,calls=0;const original=snapshot();const h=setup(async()=>{reads++;return original;},{onSnapshot:copy=>{calls++;copy.jobs[0].title='Mutated outside';}});await h.control.refresh();h.control.refreshView();
 assert.equal(reads,1);assert.equal(calls,1);assert.equal(h.control.getState().snapshot.jobs[0].title,'Task a');assert.equal(original.jobs[0].title,'Task a');
});

test('finished-only queue opens its actual task history by default; active work keeps history secondary',async()=>{for(const active of [false,true]){const h=setup(async()=>snapshot([job('done',{state:'completed'}),...(active?[job('next')]:[])]));await h.control.refresh();const panel=walk(h.container).find(node=>node.className==='queue-completed');assert.equal(panel.open,!active);}});


test('visible project accounting uses queue totals and ages current numbering without inventing missing counts',async()=>{
 let instant=Date.parse(stamp),selected='';const evidence={taskNumber:8,evidenceType:'tool_result',lastExecutionObservedAt:stamp,evidenceExpiresAt:new Date(instant+1000).toISOString()};
 const current=snapshot([job('a',{projectName:'Project A'}),job('b',{projectName:'Project B',queueRank:2})],{projectTotals:[{projectId:'p',projectName:'Project A',registered:8,completed:7,removed:0,activeRegistered:8,current:[evidence],unverifiedRunning:[],scopeChanges:[],coverage:{scope:'managed_queue',totalsComplete:true}}]});
 const h=setup(async()=>current,{now:()=>instant,getHighlightedProject:()=>selected});await h.control.refresh();
 const lines=()=>walk(h.container).filter(node=>node.className==='queue-project-line');assert.equal(lines().length,2);assert.match(lines()[0].textContent,/Project A已登记8已完成7当前编号#8/);assert.match(lines()[1].textContent,/已登记未提供已完成未提供当前编号未提供/);
 assert.equal(lines()[0].parentElement.tagName,'DIV');instant+=1000;h.control.age();assert.match(lines()[0].textContent,/当前编号待核实 #8/);assert.deepEqual(h.queueIds(),['a','b']);
 selected='Project A';h.control.refreshView();assert.equal(lines().length,1);assert.deepEqual(h.queueIds(),['a','b']);assert.equal(h.control.getState().snapshot.projectTotals[0].current[0].evidenceExpiresAt,evidence.evidenceExpiresAt);
});
