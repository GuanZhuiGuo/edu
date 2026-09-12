import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoursewareMetadata, getTopicLabel, RESOURCE_FORMS, EDUCATION_LEVELS, PRESENTATION_MODES, INTERACTION_MODES, SUBJECTS, TOPICS } from '../public/courseware-taxonomy.js';
import { BUILTIN_COURSEWARE, filterCourseware, normalizeCourseware } from '../public/courseware-store.js';

test('public vocabularies separate resource forms, topics, stages and actual capabilities', () => {
  assert.deepEqual(RESOURCE_FORMS, { knowledge_resource: '知识点资源', lesson_package: '整套课件', explainer_video: '视频讲解' });
  assert.deepEqual(Object.keys(EDUCATION_LEVELS), ['primary', 'junior', 'senior', 'higher', 'vocational']);
  assert.deepEqual(Object.keys(PRESENTATION_MODES), ['text_diagram', '2d', '3d', 'audio', 'video']);
  assert.deepEqual(Object.keys(INTERACTION_MODES), ['read', 'adjust', 'explore', 'answer']);
  assert.equal(new Set(TOPICS.map(entry => entry.id)).size, TOPICS.length);
  for (const entry of TOPICS) { assert.ok(SUBJECTS.includes(entry.subject)); assert.ok(entry.id.includes('/')); assert.ok(entry.keywords.length); }
  assert.equal(getTopicLabel('math/functions'), '函数');
  assert.equal(getTopicLabel('custom/unknown'), 'custom/unknown');
});

test('all twelve actual built-ins map by evidence without inventing videos, packages, 3D or answer workflows', () => {
  const expected = {
    sample_physics_inclined_plane: ['物理', 'physics/mechanics', ['junior'], '2d'],
    sample_physics_pendulum: ['物理', 'physics/mechanics', ['senior'], '2d'],
    sample_physics_collision: ['物理', 'physics/mechanics', ['senior'], '2d'],
    library_quadratic: ['数学', 'math/functions', ['junior'], '2d'],
    library_linear: ['数学', 'math/functions', ['junior'], '2d'],
    library_sine: ['数学', 'math/functions', ['senior'], '2d'],
    library_projectile: ['物理', 'physics/mechanics', ['senior'], '2d'],
    library_titration: ['化学', 'chemistry/reactions', ['senior'], '2d'],
    library_force_map: ['物理', 'physics/mechanics', ['senior'], 'text_diagram'],
    library_function_cards: ['数学', 'math/functions', ['senior'], 'text_diagram'],
    geometry_right_triangle: ['数学', 'math/geometry', ['junior'], '2d'],
    geometry_circle_sector: ['数学', 'math/geometry', ['junior'], '2d'],
  };
  assert.equal(BUILTIN_COURSEWARE.length, Object.keys(expected).length);
  for (const item of BUILTIN_COURSEWARE) {
    const [subject, topic, levels, mode] = expected[item.id.replace('builtin:', '')];
    const metadata = getCoursewareMetadata(item);
    assert.equal(metadata.version, 2); assert.equal(metadata.resourceForm, 'knowledge_resource');
    assert.deepEqual(metadata.subjects, [subject], item.title);
    assert.deepEqual(metadata.topicIds, [topic], item.title);
    assert.deepEqual(metadata.educationLevels, levels, item.title);
    assert.deepEqual(metadata.presentationModes, [mode], item.title);
    assert.deepEqual(metadata.interactionModes, mode === '2d' ? ['adjust', 'explore'] : ['explore']);
    assert.equal(metadata.interactionModes.includes('answer'), false);
  }
});

test('explicit metadata wins, including intentional empty fields and unknown subjects or topic ids', () => {
  const item = {
    ...structuredClone(BUILTIN_COURSEWARE[0]), catalog: {
      version: 2, resourceForm: 'lesson_package', subjects: [' 工程设计 ', '工程设计', '数学'],
      educationLevels: [], topicIds: ['custom/design', 'math/geometry'], presentationModes: ['3d', 'video'],
      interactionModes: ['answer'], keywords: [' 作者标注 ', '作者标注'], provenance: { editor: 'local' },
    },
  };
  const before = structuredClone(item); const metadata = getCoursewareMetadata(item);
  assert.deepEqual(metadata.subjects, ['工程设计', '数学']);
  assert.deepEqual(metadata.educationLevels, []);
  assert.deepEqual(metadata.topicIds, ['custom/design', 'math/geometry']);
  assert.deepEqual(metadata.presentationModes, ['3d', 'video']);
  assert.deepEqual(metadata.interactionModes, ['answer']);
  assert.deepEqual(metadata.keywords, ['作者标注']);
  assert.equal(metadata.resourceForm, 'lesson_package');
  assert.deepEqual(getCoursewareMetadata({ ...item, catalog: metadata }), metadata);
  metadata.provenance.editor = 'changed'; metadata.subjects.push('语文');
  assert.deepEqual(item, before);
  assert.deepEqual(getCoursewareMetadata({ ...item, catalog: { subjects: [], topicIds: [], keywords: [] } }).subjects, []);
});

test('legacy stage mapping uses explicit source labels and never guesses stages from topics', () => {
  for (const [label, expected] of [
    ['一年级', ['primary']], ['八年级（上）', ['junior']], ['初高中', ['junior', 'senior']],
    ['高一', ['senior']], ['大学一年级', ['higher']], ['中职二年级', ['vocational']],
    ['十一年级', []], ['待定', []], ['', []],
  ]) assert.deepEqual(getCoursewareMetadata({ lesson: { grade_band: label } }).educationLevels, expected, label);
  assert.deepEqual(getCoursewareMetadata({ title: '大学物理：量子力学', subject: '物理', type: 'visual' }).educationLevels, []);
  const unknown = getCoursewareMetadata({ title: '机器人机构设计', subject: '机器人', type: 'geometry', interactive: true });
  assert.deepEqual(unknown.subjects, ['机器人']); assert.deepEqual(unknown.topicIds, []);
  assert.deepEqual(getCoursewareMetadata({}).subjects, []);
  assert.deepEqual(getCoursewareMetadata(null).educationLevels, []);
});

test('builtin editorial stages never rewrite Lesson DSL or force new recommendations onto old user saves', () => {
  const sine = BUILTIN_COURSEWARE.find(item => item.id === 'builtin:library_sine');
  assert.equal(sine.lesson.grade_band, '初高中');
  assert.deepEqual(sine.catalog.educationLevels, ['senior']);
  const oldUserSave = structuredClone(sine);
  oldUserSave.id = 'saved:old-sine'; oldUserSave.source = 'saved'; delete oldUserSave.catalog;
  assert.deepEqual(getCoursewareMetadata(oldUserSave).educationLevels, ['junior', 'senior']);
  assert.deepEqual(normalizeCourseware(oldUserSave).catalog.educationLevels, ['junior', 'senior']);
  const unlabelledGeometry = structuredClone(BUILTIN_COURSEWARE.find(item => item.id === 'builtin:geometry_right_triangle'));
  delete unlabelledGeometry.catalog;
  assert.deepEqual(getCoursewareMetadata(unlabelledGeometry).educationLevels, []);
});

test('HTML and Lesson DSL alone do not imply a whole course, and video form needs a real video field', () => {
  assert.equal(getCoursewareMetadata({ type: 'visual', html: '<main>知识点</main>' }).resourceForm, 'knowledge_resource');
  assert.equal(getCoursewareMetadata(BUILTIN_COURSEWARE[0]).resourceForm, 'knowledge_resource');
  assert.equal(getCoursewareMetadata({ type: 'video' }).resourceForm, 'knowledge_resource');
  const video = getCoursewareMetadata({ type: 'video', videoUrl: '/assets/lesson.mp4', interactive: false });
  assert.equal(video.resourceForm, 'explainer_video'); assert.deepEqual(video.presentationModes, ['video']);
  assert.deepEqual(video.interactionModes, ['read']);
});

test('new metadata saves alongside the exact legacy renderer, full payloads, id and original creation time', () => {
  const original = {
    ...structuredClone(BUILTIN_COURSEWARE[0]), id: 'saved:original', source: 'saved',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
    html: '<!doctype html><main data-legacy="true">完整内容</main>', privateExtension: { original: [1, 2, 3] },
  };
  const before = structuredClone(original);
  const saved = normalizeCourseware(original, { now: () => '2026-09-12T00:00:00.000Z' });
  assert.equal(saved.catalog.version, 2); assert.equal(saved.id, original.id); assert.equal(saved.type, original.type);
  assert.equal(saved.createdAt, original.createdAt); assert.equal(saved.updatedAt, '2026-09-12T00:00:00.000Z');
  assert.deepEqual(saved.lesson, original.lesson); assert.equal(saved.html, original.html);
  assert.deepEqual(saved.privateExtension, original.privateExtension); assert.deepEqual(original, before);
  assert.deepEqual(normalizeCourseware(saved, { now: () => saved.updatedAt }), saved);
});

test('facet choices OR within a dimension and AND across dimensions, including subjects and legacy filters', () => {
  const results = filterCourseware(BUILTIN_COURSEWARE, {
    subject: ['数学', '物理'], type: ['function_graph', 'physics_lab'],
    technology: ['Canvas 2D', 'Planck.js'], resourceForm: ['knowledge_resource', 'lesson_package'],
    educationLevel: ['junior', 'senior'], presentationMode: ['2d'], interactionMode: ['adjust'],
    tags: ['动量', '二次函数'], source: ['builtin'], interactive: 'yes',
  });
  assert.deepEqual(results.map(item => item.id).sort(), ['builtin:library_quadratic', 'builtin:sample_physics_collision']);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { presentationMode: '3d' }).length, 0);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { interactionMode: 'answer' }).length, 0);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { educationLevel: 'higher' }).length, 0);
  const interdisciplinary = { id: 'custom', catalog: { subjects: ['数学', '工程设计'] } };
  assert.deepEqual(filterCourseware([interdisciplinary], { subject: '工程设计' }), [interdisciplinary]);
});

test('topic ancestor matching is segment-safe and independent of education level', () => {
  const items = [
    { id: 'child', catalog: { topicIds: ['math/functions/quadratic'], educationLevels: ['senior'] } },
    { id: 'parent', catalog: { topicIds: ['math/functions'], educationLevels: ['junior'] } },
    { id: 'similar', catalog: { topicIds: ['math/functions_other'], educationLevels: ['senior'] } },
  ];
  assert.deepEqual(filterCourseware(items, { topicId: 'math/functions' }).map(item => item.id), ['child', 'parent']);
  assert.deepEqual(filterCourseware(items, { topicId: 'math/functions/', educationLevel: 'senior' }).map(item => item.id), ['child']);
  assert.equal(filterCourseware(items, { topicId: 'math' }).length, 3);
  assert.equal(filterCourseware(items, { topicId: 'mat' }).length, 0);
  assert.equal(filterCourseware(items, { topicId: ['physics', 'math/functions'] }).length, 2);
});

test('query tokens AND across title, catalog labels, stage, technology and preserved keywords', () => {
  const results = filterCourseware(BUILTIN_COURSEWARE, { query: '初中\n二次函数  CANVAS 二维 调节参数' });
  assert.deepEqual(results.map(item => item.id), ['builtin:library_quadratic']);
  assert.equal(filterCourseware(BUILTIN_COURSEWARE, { query: '二次函数 不存在的主题' }).length, 0);
  const custom = { id: 'custom', title: '机构设计', catalog: { subjects: ['工程设计'], keywords: ['连杆机构'] } };
  assert.deepEqual(filterCourseware([custom], { query: '工程设计 连杆机构' }), [custom]);
  const before = structuredClone(BUILTIN_COURSEWARE);
  filterCourseware(BUILTIN_COURSEWARE, { query: '函数', subject: '数学' });
  assert.deepEqual(BUILTIN_COURSEWARE, before);
});
