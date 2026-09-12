// Discovery metadata is independent of the legacy `type` renderer contract.
// These local vocabularies are not a claim of curriculum alignment or of an
// integration with any external learning-resource platform.
export const RESOURCE_FORMS = Object.freeze({
  knowledge_resource: '知识点资源', lesson_package: '整套课件', explainer_video: '视频讲解',
});
export const EDUCATION_LEVELS = Object.freeze({
  primary: '小学', junior: '初中', senior: '高中', higher: '大学', vocational: '职业教育',
});
export const PRESENTATION_MODES = Object.freeze({
  text_diagram: '图文', '2d': '二维', '3d': '三维', audio: '音频', video: '视频',
});
export const INTERACTION_MODES = Object.freeze({
  read: '阅读观看', adjust: '调节参数', explore: '交互探索', answer: '练习作答',
});
export const SUBJECTS = Object.freeze(['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '科学', '信息科技', '艺术', '体育', '综合']);

const topic = (id, subject, label, keywords) => Object.freeze({ id, subject, label, keywords: Object.freeze(keywords) });
export const TOPICS = Object.freeze([
  topic('chinese/reading', '语文', '阅读理解', ['阅读', '古诗', '文言文', '文学']),
  topic('chinese/writing', '语文', '写作表达', ['作文', '写作', '习作']),
  topic('chinese/language', '语文', '语言积累', ['汉字', '词语', '语法', '修辞']),
  topic('math/numbers', '数学', '数与运算', ['数与运算', '分数', '小数', '整数', '比例']),
  topic('math/algebra', '数学', '代数与方程', ['代数', '方程', '不等式', '多项式']),
  topic('math/functions', '数学', '函数', ['函数', '斜率', '截距', '正弦', '余弦', '抛物线']),
  topic('math/geometry', '数学', '几何', ['几何', '三角形', '勾股', '圆', '扇形', '面积']),
  topic('math/statistics', '数学', '统计与概率', ['统计', '概率', '平均数', '方差']),
  topic('english/language', '英语', '词汇与语法', ['词汇', '语法', '时态']),
  topic('english/reading', '英语', '阅读与听力', ['阅读', '听力']),
  topic('english/writing', '英语', '口语与写作', ['口语', '写作', '作文']),
  topic('physics/mechanics', '物理', '力与运动', ['力学', '力与运动', '摩擦', '斜面', '单摆', '碰撞', '动量', '抛体', '牛顿', '加速度']),
  topic('physics/electricity', '物理', '电与磁', ['电路', '电流', '电压', '电磁', '磁场']),
  topic('physics/optics', '物理', '光与波', ['光学', '透镜', '折射', '波动', '声波']),
  topic('physics/thermodynamics', '物理', '热与能量', ['热学', '内能', '热力学', '比热']),
  topic('chemistry/substances', '化学', '物质与结构', ['物质结构', '原子', '分子', '元素', '化学键']),
  topic('chemistry/reactions', '化学', '化学反应', ['化学反应', '酸碱', '滴定', '氧化', '还原', '中和']),
  topic('chemistry/experiments', '化学', '实验方法', ['实验方法', '分离', '提纯', '仪器']),
  topic('biology/organisms', '生物', '生命与结构', ['细胞', '遗传', '生理', '生命', '植物', '动物']),
  topic('biology/ecology', '生物', '生态与环境', ['生态', '食物链', '生物多样性']),
  topic('history/history', '历史', '历史发展', ['历史', '朝代', '文明']),
  topic('geography/earth', '地理', '自然地理', ['地形', '气候', '地球', '水文']),
  topic('geography/human', '地理', '人文地理', ['人口', '城市', '产业', '人文地理']),
  topic('civics/society', '道德与法治', '社会与法治', ['道德', '法治', '公民', '社会']),
  topic('science/inquiry', '科学', '科学探究', ['科学', '探究', '实验']),
  topic('it/computing', '信息科技', '计算与信息', ['编程', '算法', '计算机', '人工智能', '信息']),
  topic('art/expression', '艺术', '艺术表达', ['音乐', '美术', '绘画', '艺术']),
  topic('pe/health', '体育', '运动与健康', ['体育', '运动', '健康']),
  topic('general/interdisciplinary', '综合', '跨学科探究', ['跨学科', '综合实践']),
]);

const topicsById = new Map(TOPICS.map(entry => [entry.id, entry]));
export const getTopicLabel = id => topicsById.get(id)?.label || String(id || '');

function strings(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).filter(entry => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))];
}
function valuesFrom(source, key, fallback, vocabulary) {
  const values = strings(Object.hasOwn(source, key) ? source[key] : fallback);
  return vocabulary ? values.filter(value => Object.hasOwn(vocabulary, value)) : values;
}
function legacyEducationLevels(item) {
  const levels = strings(item.educationLevels ?? item.educationLevel ?? item.grade_band ?? item.gradeBand ?? item.lesson?.grade_band ?? item.visualArtifact?.grade_band);
  const result = [];
  for (const level of levels) {
    if (Object.hasOwn(EDUCATION_LEVELS, level)) { result.push(level); continue; }
    const explicit = [];
    if (/小学/.test(level)) explicit.push('primary');
    if (/初中|初高中|初[一二三123]/.test(level)) explicit.push('junior');
    if (/高中|初高中|高[一二三123]/.test(level)) explicit.push('senior');
    if (/大学|高等教育|本科|研究生|大[一二三四1234]/.test(level)) explicit.push('higher');
    if (/职业|中职|高职|职高|专科/.test(level)) explicit.push('vocational');
    if (explicit.length) result.push(...explicit);
    else if (/^[一二三四五六1-6]年级/.test(level)) result.push('primary');
    else if (/^[七八九789]年级/.test(level)) result.push('junior');
  }
  return [...new Set(result)];
}
function legacyTopics(item, subjects) {
  // Known renderer semantics are stronger evidence than a title keyword.
  const known = { function_graph: ['数学', 'math/functions'], geometry: ['数学', 'math/geometry'],
    physics_lab: ['物理', 'physics/mechanics'], projectile_lab: ['物理', 'physics/mechanics'],
    acid_base_lab: ['化学', 'chemistry/reactions'] }[item.type];
  if (known && subjects.includes(known[0])) return [known[1]];
  const searchable = strings([item.title, item.description, item.lesson?.knowledge_point, ...(Array.isArray(item.tags) ? item.tags : [])]).join(' ').toLocaleLowerCase();
  return TOPICS.filter(entry => subjects.includes(entry.subject) && entry.keywords.some(keyword => searchable.includes(keyword.toLocaleLowerCase()))).map(entry => entry.id);
}
function legacyPresentation(item) {
  if (item.type === 'video' && typeof item.videoUrl === 'string' && item.videoUrl.trim()) return ['video'];
  if (['function_graph', 'geometry', 'physics_lab', 'projectile_lab', 'acid_base_lab'].includes(item.type)) return ['2d'];
  if (['mindmap', 'concept_cards', 'visual'].includes(item.type)) return ['text_diagram'];
  return [];
}
function legacyInteraction(item) {
  if (item.interactive !== true) return ['read'];
  if (['function_graph', 'geometry', 'physics_lab', 'projectile_lab', 'acid_base_lab'].includes(item.type)) return ['adjust', 'explore'];
  // Flipping a card is exploration; it does not prove an answer was submitted.
  return ['explore'];
}

/** Return a fresh metadata projection. Never mutate an item or its payload. */
export function getCoursewareMetadata(input = {}) {
  const item = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const existing = item.catalog && typeof item.catalog === 'object' && !Array.isArray(item.catalog) ? item.catalog : {};
  const subjects = valuesFrom(existing, 'subjects', item.subjects ?? item.subject ?? item.lesson?.subject ?? item.visualArtifact?.subject);
  const explicitForm = existing.resourceForm ?? item.resourceForm;
  const resourceForm = Object.hasOwn(RESOURCE_FORMS, explicitForm) ? explicitForm
    : item.type === 'video' && typeof item.videoUrl === 'string' && item.videoUrl.trim() ? 'explainer_video' : 'knowledge_resource';
  return {
    ...structuredClone(existing), version: 2, resourceForm, subjects,
    educationLevels: valuesFrom(existing, 'educationLevels', legacyEducationLevels(item), EDUCATION_LEVELS),
    topicIds: valuesFrom(existing, 'topicIds', legacyTopics(item, subjects)),
    presentationModes: valuesFrom(existing, 'presentationModes', legacyPresentation(item), PRESENTATION_MODES),
    interactionModes: valuesFrom(existing, 'interactionModes', legacyInteraction(item), INTERACTION_MODES),
    keywords: valuesFrom(existing, 'keywords', [...strings(item.tags), ...strings(item.lesson?.knowledge_point), ...strings(item.visualArtifact?.knowledge_point)]),
  };
}
