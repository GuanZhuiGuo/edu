import { PHYSICS_LESSON_SAMPLES } from './physics-lesson-samples.js';
import { BUILTIN_GEOMETRY_COURSEWARE } from './courseware-geometry.js';
import { getCoursewareMetadata, getTopicLabel, RESOURCE_FORMS, EDUCATION_LEVELS, PRESENTATION_MODES, INTERACTION_MODES } from './courseware-taxonomy.js';

export const COURSEWARE_TYPES = Object.freeze({
  function_graph: '函数图像', physics_lab: '物理实验', projectile_lab: '抛体实验',
  acid_base_lab: '化学实验', mindmap: '知识导图', concept_cards: '概念卡片',
  video: '教学视频', geometry: '几何演示', visual: '知识图解',
});

const BUILTIN_DATE = '2026-09-09T00:00:00.000Z';
// Editorial recommendations for this library's built-ins. Keep them out of
// legacy projection so existing user saves retain their original grade data.
// These suggestions are not a claim of formal curriculum alignment.
const BUILTIN_RECOMMENDED_LEVELS = Object.freeze({
  sample_physics_inclined_plane: ['junior'], sample_physics_pendulum: ['senior'], sample_physics_collision: ['senior'],
  library_quadratic: ['junior'], library_linear: ['junior'], library_sine: ['senior'],
  library_projectile: ['senior'], library_titration: ['senior'], library_force_map: ['senior'], library_function_cards: ['senior'],
  geometry_right_triangle: ['junior'], geometry_circle_sector: ['junior'],
});
function localLesson(id, title, subject, type, preset, parameters, points, guidance, extras = {}) {
  return {
    version: '1.0', lesson_id: id, title, subtitle: guidance[1], subject,
    grade_band: subject === '化学' ? '高一' : '初高中', knowledge_point: title,
    artifact_type: type, explanation: points.join('。'), learning_objectives: [points[0]],
    key_points: points, guidance: { prediction_prompt: guidance[0], observation_prompt: guidance[1], transfer_question: guidance[2] },
    visualization: { preset, parameters, nodes: [], cards: [], ...extras },
    runtime: { renderer: 'deterministic-lesson-player', renderer_version: '1.0', executable_model_code: false },
  };
}
function builtin(lesson, technology, tags) {
  return { id: `builtin:${lesson.lesson_id}`, title: lesson.title, description: lesson.subtitle,
    subject: lesson.subject, type: lesson.artifact_type, technology, tags, interactive: true,
    lesson, source: 'builtin', createdAt: BUILTIN_DATE };
}

// Actual deterministic lessons supported by the existing player. No video URLs
// or model-generation claims are invented for these local teaching examples.
export const BUILTIN_COURSEWARE = Object.freeze([
  ...Object.values(PHYSICS_LESSON_SAMPLES).map(lesson => builtin(lesson,
    lesson.visualization.engine === 'planck' ? 'Planck.js' : 'Matter.js',
    ['力学', lesson.visualization.preset === 'pendulum' ? '周期' : lesson.visualization.preset === 'collision' ? '动量' : '摩擦', '参数实验'])),
  builtin(localLesson('library_quadratic', '二次函数参数实验', '数学', 'function_graph', 'quadratic', { a: 1, b: 0, c: 0 },
    ['a 的正负决定开口方向', '|a| 越大，抛物线开口越窄', 'c 是与 y 轴交点的纵坐标'],
    ['把 a 从 1 调到 −1，图像怎样变化？', '拖动 a、b、c，对比开口、对称轴与交点。', '抛物线经过原点时，哪个参数为零？']), 'Canvas 2D', ['函数', '二次函数', '参数实验']),
  builtin(localLesson('library_linear', '一次函数：斜率与截距', '数学', 'function_graph', 'linear', { a: 1, b: 2 },
    ['斜率决定直线的倾斜方向和变化率', '截距 b 是直线与 y 轴交点的纵坐标'],
    ['斜率由正变负，直线如何变化？', '保持一个参数不变，拖动另一个参数观察直线。', '两条直线平行时，斜率有什么关系？']), 'Canvas 2D', ['函数', '一次函数', '参数实验']),
  builtin(localLesson('library_sine', '正弦函数的振幅与周期', '数学', 'function_graph', 'sine', { amplitude: 2, frequency: 1, phase: 0 },
    ['振幅 A 决定图像到中线的最大距离', '角频率 ω 越大，周期 2π/ω 越小'],
    ['把角频率增大一倍，一段区间内的波峰会怎样变化？', '分别改变振幅、角频率和相位，观察波形。', '改变振幅会改变周期吗？']), 'Canvas 2D', ['函数', '三角函数', '周期']),
  builtin(localLesson('library_projectile', '抛体运动：角度与射程', '物理', 'projectile_lab', 'projectile', { initial_speed: 20, angle: 45, gravity: 9.8 },
    ['理想抛体的水平速度不变', '同高起落、忽略空气阻力时，45° 对应最大射程'],
    ['相同初速度下，30° 和 60° 的射程相同吗？', '调整角度和速度，播放并观察理想抛物轨迹。', '重力减小时，飞行时间如何变化？']), 'Canvas 2D', ['力学', '抛体运动', '运动轨迹']),
  builtin(localLesson('library_titration', '酸碱滴定：走近等当点', '化学', 'acid_base_lab', 'acid_base_titration',
    { acid_volume_ml: 25, acid_concentration: 0.1, base_concentration: 0.1, added_base_ml: 0 },
    ['强酸与强碱按物质的量中和', '25℃ 理想强酸强碱的等当点附近 pH 约为 7'],
    ['加入多少 0.1 mol/L 的 NaOH 可中和 25 mL 同浓度的 HCl？', '逐滴加入碱，观察 pH 和酚酞颜色；本例忽略活度与温度变化。', '如果碱浓度减半，等当体积如何变化？']), 'Canvas 2D', ['化学反应', '酸碱', '参数实验']),
  builtin(localLesson('library_force_map', '力与运动的知识地图', '物理', 'mindmap', 'concept_map', {},
    ['合外力与加速度之间满足 F = ma', '匀速直线运动不需要合外力维持'],
    ['物体在运动，是否一定受到非零合外力？', '点击概念节点，连接受力、加速度与运动状态。', '汽车匀速转弯时，合外力是否为零？'],
    { nodes: [
      { id: 'force', parent_id: null, label: '力与运动', detail: '用合外力分析物体运动状态的变化。' },
      { id: 'inertia', parent_id: 'force', label: '惯性', detail: '物体具有保持原有运动状态的性质，质量是惯性大小的量度。' },
      { id: 'newton', parent_id: 'force', label: 'F = ma', detail: '质量一定时，加速度与合外力成正比，方向与合外力相同。' },
      { id: 'balance', parent_id: 'force', label: '平衡状态', detail: '合外力为零时，物体保持静止或匀速直线运动。' },
      { id: 'change', parent_id: 'newton', label: '速度变化', detail: '加速度描述速度的变化率；速度大小不变而方向改变，也有加速度。' },
    ] }), '原生 DOM', ['力学', '知识结构', '概念辨析']),
  builtin(localLesson('library_function_cards', '函数概念辨析卡', '数学', 'concept_cards', 'flashcards', {},
    ['函数为定义域内每个自变量指定唯一的函数值', '图像的交点可以帮助理解方程的解'],
    ['一个 x 对应两个不同的 y，能构成 y 关于 x 的函数吗？', '先独立回答卡面问题，再翻面核对解释。', '如何从函数图像读出方程 f(x)=0 的解？'],
    { cards: [
      { front: '什么是函数？', back: '在一个变化过程中，对定义域内每一个 x，都有唯一确定的 y 与它对应。', accent: 'blue' },
      { front: '零点与方程的解', back: '函数图像与 x 轴交点的横坐标，是方程 f(x)=0 的实数解。', accent: 'teal' },
      { front: '图像上升表示什么？', back: '在指定区间内，随着 x 增大，函数值 y 增大；描述时不能漏掉区间。', accent: 'violet' },
    ] }), '原生 DOM', ['函数', '概念辨析', '复习']),
  ...BUILTIN_GEOMETRY_COURSEWARE,
].map(item => ({ ...item, catalog: getCoursewareMetadata({ ...item,
  catalog: { educationLevels: BUILTIN_RECOMMENDED_LEVELS[item.id.slice('builtin:'.length)] },
}) })));

export class CoursewareStoreError extends Error {
  constructor(code, message, cause) { super(message, cause ? { cause } : undefined); this.name = 'CoursewareStoreError'; this.code = code; }
}
function storageError(error, action = '保存') {
  if (error instanceof CoursewareStoreError) return error;
  const quota = error?.name === 'QuotaExceededError';
  return new CoursewareStoreError(quota ? 'storage_full' : 'storage_failed', quota
    ? '此设备的存储空间不足，课件未保存。请释放空间后重试。'
    : `${action}课件失败，请检查浏览器是否允许此站点使用本地存储后重试。`, error);
}

export function normalizeCourseware(item, { now = () => new Date().toISOString(), createId = () => `courseware:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}` } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CoursewareStoreError('invalid_item', '缺少有效的课件内容。');
  if (typeof item.title !== 'string' || !item.title.trim()) throw new CoursewareStoreError('invalid_title', '请先填写课件名称。');
  if (!Object.hasOwn(COURSEWARE_TYPES, item.type)) throw new CoursewareStoreError('invalid_type', '不支持此课件类型。');
  const hasLesson = item.lesson && typeof item.lesson === 'object' && !Array.isArray(item.lesson);
  const hasVisual = item.visualArtifact && typeof item.visualArtifact === 'object' && !Array.isArray(item.visualArtifact);
  const hasHtml = typeof item.html === 'string' && item.html.trim().length > 0;
  const hasVideo = typeof item.videoUrl === 'string' && item.videoUrl.trim().length > 0;
  if (!hasLesson && !hasVisual && !hasHtml && !hasVideo) throw new CoursewareStoreError('missing_content', '课件没有可保存的教材、几何数据、HTML 或视频地址。');
  if (hasVisual && item.type === 'geometry') {
    const artifact = item.visualArtifact; const model = artifact.model;
    const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
    const triangle = artifact.variant === 'triangle' && model?.kind === 'right_triangle'
      && inRange(model.a, 1, 12) && inRange(model.b, 1, 12) && model.angle === 90 && model.angle_control === false;
    const circle = artifact.variant === 'circle' && model?.kind === 'circle_elements'
      && inRange(model.radius, 1, 12) && inRange(model.angle, 15, 360);
    if (artifact.schema_version !== 'interactive-visual@1.0' || (!triangle && !circle)) {
      throw new CoursewareStoreError('invalid_geometry', '几何数据不符合当前可交互模板，请使用直角三角形或圆与扇形模板后重试。');
    }
  }
  if (hasVideo) {
    try {
      const value = item.videoUrl.trim();
      if (!/^(?:https?:\/\/|\/(?!\/))/i.test(value) || !['http:', 'https:'].includes(new URL(value, 'https://courseware.invalid').protocol)) throw new Error('invalid URL');
    } catch {
      throw new CoursewareStoreError('invalid_video_url', '视频需要可持续访问的 HTTP(S) 或站内地址，临时 blob 地址无法在刷新后恢复。');
    }
  }
  let copy;
  try { copy = structuredClone(item); } catch (error) { throw new CoursewareStoreError('invalid_content', '课件包含无法保存的数据，请重新生成后重试。', error); }
  const id = typeof copy.id === 'string' && copy.id && !copy.id.startsWith('builtin:') ? copy.id : createId();
  const createdAt = typeof copy.createdAt === 'string' && Number.isFinite(Date.parse(copy.createdAt)) && copy.source !== 'builtin' ? copy.createdAt : now();
  return {
    ...copy, id, title: copy.title.trim(), description: String(copy.description || ''),
    subject: String(copy.subject || copy.lesson?.subject || '综合'), type: copy.type,
    technology: ({ matter: 'Matter.js', planck: 'Planck.js' })[copy.technology] || String(copy.technology || '原生 DOM'),
    tags: [...new Set((Array.isArray(copy.tags) ? copy.tags : []).filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))],
    interactive: copy.interactive === true, source: 'saved', createdAt, updatedAt: now(),
    catalog: getCoursewareMetadata(copy),
    ...(hasVideo ? { videoUrl: copy.videoUrl.trim() } : {}),
  };
}

// Dependency injection keeps transaction/abort behavior testable without a
// browser. Each operation closes its connection and resolves only on commit.
export function createCoursewareStore({ indexedDB, eventTarget, now, createId, databaseName = 'ai-teacher-courseware-v1', fetchImpl, serverEndpoint = '/api/courseware-library' } = {}) {
  const remoteFetch = fetchImpl || (typeof window !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  async function open() {
    const factory = indexedDB ?? globalThis.indexedDB;
    if (!factory?.open) throw new CoursewareStoreError('storage_unavailable', '此浏览器暂不能读取或保存本地课件。请允许站点存储后重试。');
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      try { request = factory.open(databaseName, 1); } catch (error) { reject(storageError(error, '打开')); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('courseware')) request.result.createObjectStore('courseware', { keyPath: 'id' });
      };
      request.onblocked = () => { settled = true; reject(new CoursewareStoreError('storage_blocked', '其他页面阻止了课件库升级，请关闭同站点的旧页面后重试。')); };
      request.onerror = () => { settled = true; reject(storageError(request.error, '打开')); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function run(mode, operation, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, value, requestError;
      try {
        tx = db.transaction('courseware', mode);
        tx.oncomplete = () => { db.close(); resolve(value); };
        tx.onabort = () => { db.close(); reject(storageError(tx.error || requestError, action)); };
        tx.onerror = () => { requestError = tx.error; };
        operation(tx.objectStore('courseware'), result => { value = result; });
      } catch (error) {
        try { tx?.abort(); } catch { /* Already completed. */ }
        db.close(); reject(storageError(error, action));
      }
    });
  }
  function changed(action, id) {
    const target = eventTarget ?? globalThis.document;
    if (!target?.dispatchEvent) return;
    const EventClass = globalThis.CustomEvent;
    if (EventClass) target.dispatchEvent(new EventClass('courseware:changed', { detail: { action, id } }));
  }
  async function remote(path = '', options = {}) {
    if (!remoteFetch) return null;
    const response = await remoteFetch(`${serverEndpoint}${path}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new CoursewareStoreError(payload.error || 'storage_failed', payload.message || `课件库返回 HTTP ${response.status}`);
    return payload;
  }
  return {
    async saveCourseware(input) {
      const item = normalizeCourseware(input, { now, createId });
      let remoteItem = null; let remoteError = null; let localError = null;
      try { remoteItem = (await remote('', { method: 'POST', body: JSON.stringify(item) }))?.item || null; }
      catch (error) { remoteError = error; }
      try { await run('readwrite', (store, result) => { store.put(remoteItem || item); result(remoteItem || item); }, '保存'); }
      catch (error) { localError = error; }
      if (!remoteItem && localError) throw remoteError || localError;
      changed('save', item.id);
      return structuredClone(remoteItem || item);
    },
    async listCourseware() {
      let saved = []; let remoteItems = []; let localError = null; let remoteError = null;
      try { saved = await run('readonly', (store, result) => { const request = store.getAll(); request.onsuccess = () => result(request.result); }, '读取'); }
      catch (error) { localError = error; }
      try { remoteItems = (await remote())?.items || []; }
      catch (error) { remoteError = error; }
      if (localError && (!remoteFetch || remoteError)) throw localError;
      const merged = new Map();
      for (const item of [...saved, ...remoteItems]) {
        const existing = merged.get(item.id);
        if (!existing || String(item.updatedAt || item.createdAt) > String(existing.updatedAt || existing.createdAt)) merged.set(item.id, item);
      }
      // Project legacy records in memory; a read never upgrades or rewrites
      // IndexedDB rows, their timestamps, or their renderer payloads.
      return [[...merged.values()].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))), structuredClone(BUILTIN_COURSEWARE)].flat()
        .map(item => ({ ...item, catalog: getCoursewareMetadata(item) }));
    },
    async deleteCourseware(id) {
      if (typeof id !== 'string' || !id || id.startsWith('builtin:')) throw new CoursewareStoreError('builtin_readonly', '内置示例不能删除，可以保存自己的副本。');
      let remoteDeleted = false; let remoteError = null; let localDeleted = false; let localError = null;
      try { remoteDeleted = Boolean((await remote(`/${encodeURIComponent(id)}`, { method: 'DELETE' }))?.deleted); }
      catch (error) { remoteError = error; }
      try { await run('readwrite', (store) => { store.delete(id); }, '删除'); localDeleted = true; }
      catch (error) { localError = error; }
      if (!remoteDeleted && !localDeleted && (remoteError || localError)) throw remoteError || localError;
      changed('delete', id);
    },
  };
}

const defaultStore = createCoursewareStore();
export const saveCourseware = item => defaultStore.saveCourseware(item);
export const listCourseware = () => defaultStore.listCourseware();
export const deleteCourseware = id => defaultStore.deleteCourseware(id);

export function filterCourseware(items, filters = {}) {
  const selected = value => (Array.isArray(value) ? value : [value]).filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim());
  const matches = (filter, values, compare = (a, b) => a === b) => {
    const choices = selected(filter); const actual = selected(values);
    return !choices.length || choices.some(choice => actual.some(value => compare(choice, value)));
  };
  const queryTokens = String(filters.query || '').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return items.filter(item => {
    const catalog = getCoursewareMetadata(item);
    if (!(matches(filters.source, item.source)
      && matches(filters.type, item.type)
      && matches(filters.technology, item.technology)
      && matches(filters.resourceForm, catalog.resourceForm)
      && matches(filters.subject, catalog.subjects)
      && matches(filters.educationLevel, catalog.educationLevels)
      && matches(filters.topicId, catalog.topicIds, (choice, value) => {
        const prefix = choice.replace(/\/+$/, ''); return value === prefix || value.startsWith(`${prefix}/`);
      })
      && matches(filters.presentationMode, catalog.presentationModes)
      && matches(filters.interactionMode, catalog.interactionModes)
      && matches(filters.interactive, item.interactive ? 'yes' : 'no')
      && matches(filters.tags, item.tags))) return false;
    if (!queryTokens.length) return true;
    const searchable = [item.title, item.description, item.subject, item.technology, item.type, COURSEWARE_TYPES[item.type],
      item.lesson?.knowledge_point, item.lesson?.grade_band, ...selected(item.tags),
      catalog.resourceForm, RESOURCE_FORMS[catalog.resourceForm], ...catalog.subjects, ...catalog.keywords,
      ...catalog.topicIds.flatMap(id => [id, getTopicLabel(id)]),
      ...catalog.educationLevels.flatMap(id => [id, EDUCATION_LEVELS[id]]),
      ...catalog.presentationModes.flatMap(id => [id, PRESENTATION_MODES[id]]),
      ...catalog.interactionModes.flatMap(id => [id, INTERACTION_MODES[id]]),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return queryTokens.every(token => searchable.includes(token));
  });
}
