// Local teaching examples. Motion is calculated by the selected physics engine.
export const PHYSICS_LESSON_SAMPLES = Object.freeze({
  inclined_plane: sample('inclined_plane', 'matter', '斜面与摩擦', '改变倾角和摩擦，观察滑块怎样运动',
    { angle: 30, friction: 0.1, gravity: 9.8, mass: 1 },
    ['比较斜面倾角和摩擦对滑块运动的影响'],
    ['沿斜面的重力分量随倾角增大而增大', '滑动摩擦会减小沿斜面的加速度', '相同条件下，加速度与滑块质量无关'],
    ['先预测：把斜面调得更陡，滑块会怎样运动？', '每次只改变一个参数，重置后对比同一时刻的速度。', '如果倾角不变，只增大质量，加速度会改变吗？']),
  pendulum: sample('pendulum', 'matter', '单摆的周期', '改变摆长和初始摆角，观察往复运动',
    { length: 1.5, angle: 25, gravity: 9.8, mass: 1 },
    ['观察摆长与单摆周期的关系'],
    ['摆长越长，摆动周期越大', '小角度时周期近似为 T = 2π√(L/g)', '大摆角时，小角度周期公式会有偏差'],
    ['先预测：摆长加倍，摆动会变快还是变慢？', '比较相同时间内完成的摆动次数，留意摆长和初始摆角。', '同样的单摆放在重力更小的环境中，周期会怎样变化？']),
  collision: sample('collision', 'planck', '小车碰撞', '改变初速度和恢复系数，比较碰撞前后的运动',
    { initial_speed: 3, restitution: 0.9, mass: 1, mass_b: 1 },
    ['探究质量和恢复系数对一维碰撞的影响'],
    ['水平无摩擦、无外力时，碰撞前后总动量近似守恒', '恢复系数决定碰撞后的相对分离速度', '恢复系数为 1 时接近弹性碰撞；小于 1 时动能有损失'],
    ['先预测：相同质量的小车发生弹性碰撞后，速度如何变化？', '先将恢复系数调到 1，再减小它，观察两车速度。', '把静止小车的质量加倍，碰撞后的运动会怎样变化？']),
});

function sample(preset, engine, title, subtitle, parameters, learningObjectives, keyPoints, prompts) {
  return Object.freeze({
    version: '1.0', lesson_id: `sample_physics_${preset}`, title, subtitle,
    subject: '物理', grade_band: preset === 'inclined_plane' ? '八年级' : '高一',
    knowledge_point: title, artifact_type: 'physics_lab', explanation: subtitle,
    learning_objectives: learningObjectives, key_points: keyPoints,
    guidance: { prediction_prompt: prompts[0], observation_prompt: prompts[1], transfer_question: prompts[2] },
    visualization: { preset, engine, parameters, nodes: [], cards: [] },
    runtime: { renderer: 'deterministic-lesson-player', renderer_version: '1.0', executable_model_code: false },
  });
}
