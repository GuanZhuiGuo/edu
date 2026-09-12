import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_COURSEWARE, normalizeCourseware, createCoursewareStore, filterCourseware } from '../public/courseware-store.js';
import { coursewareCoverSvg, captureCoursewarePreview } from '../public/courseware-library.js';
import { BUILTIN_GEOMETRY_COURSEWARE, mountGeometryCourseware } from '../public/courseware-geometry.js';
import { normalizeInteractiveLessonDsl } from '../interactive-lesson-contract.js';

const clock = () => '2026-09-09T10:00:00.000Z';
const fixture = overrides => ({ ...structuredClone(BUILTIN_COURSEWARE[0]), ...overrides });

// A transaction fault harness, not a browser replacement. It independently
// stages writes, can delay commit and can abort after request success.
function indexedDbHarness() {
  const rows = new Map();
  const harness = { rows, hold: false, fail: null, current: null, closed: 0, modes: [], writes: 0 };
  harness.open = () => {
    const request = {};
    queueMicrotask(() => {
      const db = {
        objectStoreNames: { contains: () => true },
        close() { harness.closed += 1; },
        transaction(name, mode) {
          assert.equal(name, 'courseware');
          assert.ok(['readonly', 'readwrite'].includes(mode));
          harness.modes.push(mode);
          const pending = new Map([...rows].map(([id, item]) => [id, structuredClone(item)]));
          const tx = { error: null, done: false };
          const makeRequest = result => { const next = { result }; queueMicrotask(() => next.onsuccess?.()); return next; };
          tx.objectStore = () => ({
            put(item) { assert.equal(mode, 'readwrite'); harness.writes += 1; pending.set(item.id, structuredClone(item)); return makeRequest(item.id); },
            getAll() { return makeRequest([...pending.values()].map(value => structuredClone(value))); },
            delete(id) { assert.equal(mode, 'readwrite'); pending.delete(id); return makeRequest(undefined); },
          });
          tx.abort = () => { if (tx.done) return; tx.done = true; queueMicrotask(() => tx.onabort?.()); };
          tx.commit = () => {
            if (tx.done) return;
            tx.done = true;
            if (harness.fail) { tx.error = harness.fail; harness.fail = null; tx.onabort?.(); }
            else { rows.clear(); for (const [id, value] of pending) rows.set(id, value); tx.oncomplete?.(); }
          };
          harness.current = tx;
          if (!harness.hold) setTimeout(() => tx.commit(), 0);
          return tx;
        },
      };
      request.result = db; request.onsuccess?.();
    });
    return request;
  };
  return harness;
}

test('the original ten built-in lessons retain the real Lesson DSL contract and exact parameters', () => {
  const lessons = BUILTIN_COURSEWARE.filter(item => item.lesson);
  assert.equal(lessons.length, 10);
  assert.equal(BUILTIN_COURSEWARE.length, 12);
  assert.equal(new Set(BUILTIN_COURSEWARE.map(item => item.id)).size, BUILTIN_COURSEWARE.length);
  for (const item of lessons) {
    const normalized = normalizeInteractiveLessonDsl(item.lesson);
    assert.equal(normalized.artifact_type, item.type, item.title);
    assert.equal(normalized.visualization.preset, item.lesson.visualization.preset, item.title);
    assert.deepEqual(normalized.visualization.parameters, item.lesson.visualization.parameters, item.title);
    assert.equal(normalized.visualization.nodes.length, item.lesson.visualization.nodes.length, item.title);
    assert.equal(normalized.visualization.cards.length, item.lesson.visualization.cards.length, item.title);
    assert.equal(item.source, 'builtin');
    assert.equal(item.videoUrl, undefined);
  }
});

test('two geometry built-ins retain their normalized models without re-normalizing right-angle control', () => {
  assert.equal(BUILTIN_GEOMETRY_COURSEWARE.length, 2);
  for (const item of BUILTIN_GEOMETRY_COURSEWARE) {
    assert.ok(BUILTIN_COURSEWARE.some(entry => entry.id === item.id));
    assert.equal(item.visualArtifact.schema_version, 'interactive-visual@1.0');
    assert.equal(item.type, 'geometry'); assert.equal(item.technology, 'SVG');
    const saved = normalizeCourseware(item);
    assert.deepEqual(saved.visualArtifact, item.visualArtifact);
    assert.equal(saved.lesson, undefined); assert.equal(saved.html, undefined);
    if (item.visualArtifact.variant === 'triangle') {
      assert.equal(saved.visualArtifact.model.angle, 90);
      assert.equal(saved.visualArtifact.model.angle_control, false);
    } else {
      assert.equal(saved.visualArtifact.model.radius, 3);
      assert.equal(saved.visualArtifact.model.angle, 90);
    }
  }
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { type: 'geometry', technology: 'SVG', tags: ['平面几何'], interactive: 'yes' }).length, 2);
});

test('geometry without the supported bounded model is rejected explicitly', () => {
  const invalid = structuredClone(BUILTIN_GEOMETRY_COURSEWARE[0]);
  invalid.visualArtifact.model.kind = 'general_triangle';
  assert.throws(() => normalizeCourseware(invalid), { code: 'invalid_geometry' });
  invalid.visualArtifact.model.kind = 'right_triangle';
  invalid.visualArtifact.model.angle_control = true;
  assert.throws(() => normalizeCourseware(invalid), { code: 'invalid_geometry' });
  invalid.visualArtifact.model.angle_control = false;
  invalid.visualArtifact.model.a = Number.NaN;
  assert.throws(() => normalizeCourseware(invalid), { code: 'invalid_geometry' });
});

test('actual geometry controls survive preview capture, save, reopen and assistant reuse without duplicate ids', async () => {
  const database = indexedDbHarness();
  let id = 0;
  const store = createCoursewareStore({ indexedDB: database, now: clock, createId: () => `saved:geometry-${++id}` });
  for (const builtin of BUILTIN_GEOMETRY_COURSEWARE) {
    const doc = new GeometryTestDocument(); const container = doc.createElement('div');
    const changes = [];
    const player = mountGeometryCourseware(container, builtin, { onChange: item => changes.push(item) });
    const triangle = builtin.visualArtifact.variant === 'triangle';
    const selector = triangle ? 'input[aria-label="边 a"]' : 'input[aria-label="圆心角"]';
    const input = container.querySelector(selector);
    input.value = triangle ? '7.5' : '225'; input.dispatchEvent({ type: 'input' });
    assert.equal(changes.length, 1);
    if (triangle) assert.match(container.querySelector('[data-visual-status]').textContent, /第三边 8.5/);
    else assert.match(container.querySelector('[data-visual-status]').textContent, /扇形占比 62.5%/);
    const current = captureCoursewarePreview(builtin, { geometryPlayer: player });
    assert.deepEqual(current.visualArtifact, changes[0].visualArtifact);
    const saved = await store.saveCourseware(current);
    assert.equal(saved.source, 'saved'); assert.notEqual(saved.id, builtin.id);
    // A mounted player retains its original builtin metadata; the library must
    // merge only its live artifact into the latest successfully saved item.
    const repeated = captureCoursewarePreview(saved, { geometryPlayer: player });
    assert.equal(repeated.id, saved.id); assert.equal(repeated.source, 'saved');
    await store.saveCourseware(repeated);
    const reopenedStore = createCoursewareStore({ indexedDB: database });
    const restored = (await reopenedStore.listCourseware()).find(item => item.id === saved.id);
    assert.deepEqual(restored.visualArtifact, current.visualArtifact);
    const restoredContainer = doc.createElement('div');
    const restoredPlayer = mountGeometryCourseware(restoredContainer, restored);
    assert.equal(restoredContainer.querySelector(selector).value, input.value);
    if (triangle) assert.equal(restoredContainer.querySelector('input[aria-label="夹角"]'), null);
    const reused = captureCoursewarePreview(restored, { geometryPlayer: restoredPlayer, forReuse: true });
    assert.equal(reused.id, saved.id); assert.deepEqual(reused.visualArtifact, current.visualArtifact);
    const assistantContainer = doc.createElement('div');
    const assistantPlayer = mountGeometryCourseware(assistantContainer, reused);
    assert.equal(assistantContainer.querySelector(selector).value, input.value);
    if (triangle) assert.equal(assistantPlayer.getCourseware().visualArtifact.model.angle_control, false);
    player.destroy(); player.destroy(); restoredPlayer.destroy(); assistantPlayer.destroy();
    assert.equal(input.listeners.get('input').size, 0);
  }
  const saved = (await store.listCourseware()).filter(item => item.source === 'saved');
  assert.equal(saved.length, 2);
});

test('normalization retains complete lesson and HTML, makes a saved copy and does not mutate input', () => {
  const original = fixture({ html: '<!doctype html><script>const x = "原始课件";</script>', tags: ['力学', '力学', ' 参数 '] });
  const result = normalizeCourseware(original, { now: clock, createId: () => 'saved:one' });
  assert.equal(result.id, 'saved:one');
  assert.equal(result.source, 'saved');
  assert.equal(result.createdAt, clock());
  assert.equal(result.html, original.html);
  assert.deepEqual(result.lesson, original.lesson);
  assert.deepEqual(result.tags, ['力学', '参数']);
  result.lesson.visualization.parameters.angle = 45;
  assert.equal(original.lesson.visualization.parameters.angle, 30);
  assert.equal(original.source, 'builtin');
});

test('invalid content and nonpersistent video addresses fail explicitly', () => {
  for (const videoUrl of ['blob:http://localhost/123', 'javascript:alert(1)', 'data:video/mp4;base64,AAAA', '//example.com/movie.mp4', 'https://']) {
    assert.throws(() => normalizeCourseware({ title: '视频', type: 'video', videoUrl }), { code: 'invalid_video_url' });
  }
  assert.throws(() => normalizeCourseware({ title: '空课件', type: 'visual' }), { code: 'missing_content' });
  assert.throws(() => normalizeCourseware({ title: '错误类型', type: 'script', html: '<p>x</p>' }), { code: 'invalid_type' });
  assert.throws(() => normalizeCourseware(fixture({ lesson: { callback() {} } })), { code: 'invalid_content' });
  assert.equal(normalizeCourseware({ title: '视频', type: 'video', videoUrl: '/assets/lesson.mp4' }).videoUrl, '/assets/lesson.mp4');
});

test('save resolves and announces change only after transaction commit', async () => {
  const database = indexedDbHarness(); database.hold = true;
  const target = new EventTarget(); const events = []; target.addEventListener('courseware:changed', event => events.push(event.detail));
  const store = createCoursewareStore({ indexedDB: database, eventTarget: target, now: clock, createId: () => 'saved:commit' });
  let resolved = false;
  const saving = store.saveCourseware(fixture()).then(item => { resolved = true; return item; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(resolved, false);
  assert.equal(events.length, 0);
  assert.equal(database.rows.size, 0);
  database.current.commit();
  const saved = await saving;
  assert.equal(saved.id, 'saved:commit');
  assert.deepEqual(events, [{ action: 'save', id: saved.id }]);
  assert.equal(database.rows.size, 1);
  assert.equal(database.closed, 1);
});

test('a new store instance restores full content and updates the same saved record', async () => {
  const database = indexedDbHarness();
  const first = createCoursewareStore({ indexedDB: database, now: clock, createId: () => 'saved:restore' });
  const content = fixture({ html: '<html><body>完整内容</body></html>' });
  const saved = await first.saveCourseware(content);
  const reopened = createCoursewareStore({ indexedDB: database, now: () => '2026-09-10T10:00:00.000Z' });
  const restored = (await reopened.listCourseware()).find(item => item.id === saved.id);
  assert.deepEqual(restored.lesson, content.lesson);
  assert.equal(restored.html, content.html);
  const updated = await reopened.saveCourseware({ ...restored, title: '更改标题', technology: 'matter' });
  assert.equal(updated.createdAt, clock());
  assert.equal(updated.technology, 'Matter.js');
  const listed = await reopened.listCourseware();
  assert.equal(listed.filter(item => item.source === 'saved').length, 1);
  assert.equal(listed.find(item => item.id === saved.id).title, '更改标题');
  await reopened.deleteCourseware(saved.id);
  assert.equal((await reopened.listCourseware()).filter(item => item.source === 'saved').length, 0);
});

test('reading legacy rows projects catalog v2 without writing ids, timestamps or payloads; normal save persists it', async () => {
  const database = indexedDbHarness();
  const legacy = fixture({ id: 'saved:legacy', source: 'saved', html: '<main>原始课件</main>',
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z', extension: { retained: true } });
  delete legacy.catalog;
  database.rows.set(legacy.id, structuredClone(legacy));
  const store = createCoursewareStore({ indexedDB: database, now: clock });
  const listed = await store.listCourseware();
  const projected = listed.find(item => item.id === legacy.id);
  assert.equal(projected.catalog.version, 2);
  const { catalog, ...unchanged } = projected;
  assert.deepEqual(unchanged, legacy);
  assert.ok(listed.every(item => item.catalog.version === 2));
  assert.deepEqual(database.modes, ['readonly']); assert.equal(database.writes, 0);
  assert.deepEqual(database.rows.get(legacy.id), legacy);
  assert.deepEqual(await store.listCourseware(), listed);
  const saved = await store.saveCourseware(projected);
  assert.equal(database.writes, 1); assert.equal(saved.id, legacy.id);
  assert.equal(saved.createdAt, legacy.createdAt); assert.equal(saved.updatedAt, clock());
  assert.deepEqual(saved.catalog, catalog); assert.deepEqual(saved.lesson, legacy.lesson);
  assert.equal(database.rows.get(legacy.id).catalog.version, 2);
  assert.equal(database.rows.size, 1);
});

test('quota failure after a successful request does not persist or emit success', async () => {
  const database = indexedDbHarness(); database.fail = new DOMException('full', 'QuotaExceededError');
  const target = new EventTarget(); let announcements = 0; target.addEventListener('courseware:changed', () => announcements++);
  const store = createCoursewareStore({ indexedDB: database, eventTarget: target });
  await assert.rejects(store.saveCourseware(fixture()), { code: 'storage_full' });
  assert.equal(database.rows.size, 0);
  assert.equal(announcements, 0);
});

test('failed deletion preserves the saved record and does not emit deletion success', async () => {
  const database = indexedDbHarness(); const target = new EventTarget(); const actions = [];
  target.addEventListener('courseware:changed', event => actions.push(event.detail.action));
  const store = createCoursewareStore({ indexedDB: database, eventTarget: target });
  const saved = await store.saveCourseware(fixture());
  database.fail = new DOMException('abort', 'AbortError');
  await assert.rejects(store.deleteCourseware(saved.id), { code: 'storage_failed' });
  assert.equal(database.rows.has(saved.id), true);
  assert.deepEqual(actions, ['save']);
  await assert.rejects(store.deleteCourseware(BUILTIN_COURSEWARE[0].id), { code: 'builtin_readonly' });
});

test('unavailable or blocked IndexedDB is surfaced instead of an empty successful result', async () => {
  const unavailable = createCoursewareStore({ indexedDB: {} });
  await assert.rejects(unavailable.listCourseware(), { code: 'storage_unavailable' });
  await assert.rejects(unavailable.saveCourseware(fixture()), { code: 'storage_unavailable' });
  const blocked = createCoursewareStore({ indexedDB: { open() { const request = {}; queueMicrotask(() => request.onblocked()); return request; } } });
  await assert.rejects(blocked.listCourseware(), { code: 'storage_blocked' });
});

test('search, source, subject, technology, type, interaction and tags combine by intersection', () => {
  const results = filterCourseware(BUILTIN_COURSEWARE, { query: '二次', subject: '数学', type: 'function_graph', technology: 'Canvas 2D', source: 'builtin', interactive: 'yes', tags: ['函数', '参数实验'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].lesson.visualization.preset, 'quadratic');
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { technology: 'Planck.js', tags: ['动量'] }).length, 1);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { interactive: 'no' }).length, 0);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { source: 'saved' }).length, 0);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { query: '', tags: [] }).length, BUILTIN_COURSEWARE.length);
});

test('knowledge covers contain real figures and escape stored lesson labels', () => {
  const covers = BUILTIN_COURSEWARE.map(coursewareCoverSvg);
  assert.equal(new Set(covers).size, BUILTIN_COURSEWARE.length);
  for (const cover of covers) { assert.match(cover, /<svg/); assert.match(cover, /<(?:path|line|rect)/); assert.doesNotMatch(cover, /<script|onload=/i); }
  const malicious = coursewareCoverSvg({ title: '<script>alert(1)</script>', subject: '综合', type: 'visual' });
  assert.doesNotMatch(malicious, /<script/i);
  assert.match(malicious, /&lt;script&gt;/);
});

// Minimal DOM for exercising the real SVG renderer and its real input
// listeners. It does not claim browser layout, focus or accessibility coverage.
class GeometryTestDocument {
  createElement(tag) { return new GeometryTestElement(this, tag); }
  createElementNS(namespace, tag) { const node = this.createElement(tag); node.namespaceURI = namespace; return node; }
}
class GeometryTestElement {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.localName = tag; this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.value = ''; this.ownText = '';
    const classes = new Set(); this.classList = { add: (...values) => values.forEach(value => classes.add(value)) };
  }
  get firstElementChild() { return this.children[0] || null; }
  get textContent() { return this.ownText + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value ?? ''); }
  set innerHTML(value) { throw new Error('SVG geometry must not inject HTML'); }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) { node.remove(); node.parentNode = this; this.children.push(node); return node; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.ownText = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler.call(this, event); return true; }
  matches(selector) {
    if (selector.includes('>')) { const [parent, child] = selector.split('>').map(value => value.trim()); return this.matches(child) && this.parentNode?.matches(parent); }
    const match = selector.match(/^(\w+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
    return Boolean(match && (!match[1] || this.localName === match[1]) && (!match[2] || this.attributes.has(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3])));
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim()); const result = [];
    const visit = node => { for (const child of node.children) { if (selectors.some(value => child.matches(value))) result.push(child); visit(child); } };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
