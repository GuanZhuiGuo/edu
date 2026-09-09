const STATUS_LABELS = Object.freeze({
  ready: "当前可生成",
  candidate: "规划中",
});

const ARTIFACT_LABELS = Object.freeze({
  function_graph: "互动函数图",
  projectile_lab: "抛体运动实验",
  physics_lab: "物理参数实验",
  acid_base_lab: "酸碱滴定实验",
  mindmap: "互动思维导图",
  concept_cards: "概念翻转卡",
});

export const GENERATION_GUIDANCE = Object.freeze([
  subject("语文", "阅读结构、语言积累与写作表达", [
    example("chinese-poem", "分类与层级", "古诗意象与情感", "互动思维导图", "ready", "mindmap", "七年级", "梳理《天净沙·秋思》中意象、画面、情感与主旨的关系", "知识点有清晰的从属关系", "展开意象节点，查看画面与情感"),
    example("chinese-classical", "记忆与辨析", "文言实词一词多义", "概念翻转卡", "ready", "concept_cards", "八年级", "在不同语境中辨析《桃花源记》重点实词的含义", "需要反复回忆和对比易混释义", "先猜词义，再翻卡看语境与例句"),
    example("chinese-writing", "步骤与作品", "记叙文线索与写作修改", "分步写作工作台", "candidate", "", "九年级", "按立意、素材、结构和语言逐步完成记叙文修改", "学习结果需要多轮创作与反馈", "按阶段提交片段，对照量规修改", "Tiptap", "mindmap"),
  ]),
  subject("数学", "参数规律、空间关系与严格推导", [
    example("math-quadratic", "参数改变", "二次函数图像与参数", "互动函数图", "ready", "function_graph", "九年级", "理解 a、b、c 对抛物线开口、对称轴和位置的影响", "核心是观察参数与图像的连续对应", "拖动参数，边预测边观察图像"),
    example("math-sine", "参数改变", "正弦函数的振幅与周期", "互动函数图", "ready", "function_graph", "高一", "比较振幅、频率和相位改变时的图像变化", "多个参数会影响周期图像", "分别改变 A、ω、φ，对比关键点"),
    example("math-geometry", "空间与约束", "圆周角定理", "动态几何", "candidate", "", "九年级", "通过拖动圆周上的点验证圆周角与圆心角的关系", "点移动后需保持几何约束和实时测量", "拖动点，对比角度并寻找不变量", "JSXGraph", "mindmap"),
  ]),
  subject("英语", "词汇语法、语篇结构与听说实践", [
    example("english-verbs", "记忆与辨析", "不规则动词变化", "概念翻转卡", "ready", "concept_cards", "七年级", "掌握常见动词的原形、过去式和语境用法", "词形需要频繁召回并放入例句", "看原形说过去式，翻卡看例句"),
    example("english-tense", "分类与对比", "一般过去时与现在完成时", "互动思维导图", "ready", "mindmap", "八年级", "从时间标志、句式和使用场景区分两种时态", "需要把多组特征放在同一框架中比较", "展开两条分支，对比标志词与例句"),
    example("english-speaking", "听说与模仿", "音标、连读与情景对话", "语音跟读练习", "candidate", "", "八年级", "在真实对话中识别连读并完成跟读自评", "学习目标是声音辨识和产出而非静态记忆", "听原音、录音跟读、对比节奏", "H5P", "concept_cards"),
  ]),
  subject("物理", "可测参数、连续运动与装置规律", [
    physicsExample("inclined_plane", "matter", "physics-inclined-plane", "受力与摩擦", "斜面与摩擦", "八年级", "控制倾角与摩擦系数，比较滑块运动与速度变化", "固定斜面和滑块由 Matter.js 求解，适合中小学二维力学演示", "先预测，再分别改变倾角和摩擦，重置后比较同一时刻的运动"),
    physicsExample("pendulum", "matter", "physics-pendulum", "约束与周期", "单摆的周期", "高一", "比较摆长、重力和释放角度对单摆周期的影响", "Matter.js 求解单摆约束；小角度周期公式只作为近似参考", "每次只改变一个参数，对比相同时间内摆动的次数"),
    physicsExample("collision", "planck", "physics-collision", "碰撞与动量", "小车一维正碰", "高一", "改变两车质量、初速度和恢复系数，比较一维碰撞前后的运动", "Planck.js 使用 Box2D 风格刚体求解；当前为无摩擦一维正碰预设", "先用相同质量和恢复系数 1 实验，再改变质量或弹性比较结果"),
    example("physics-projectile", "参数与运动", "抛体运动", "抛体运动实验", "ready", "projectile_lab", "高一", "研究初速度、发射角和重力加速度对轨迹的影响", "结论来自参数与运动轨迹的对应", "改变发射条件，观察射程和最高点"),
    example("physics-vt", "数量关系", "匀速与匀变速运动图像", "互动函数图", "ready", "function_graph", "八年级", "用位移—时间和速度—时间图像解释运动状态", "物理量间存在可视化的线性关系", "调整斜率和截距，联系速度与初始位置"),
    example("physics-circuit", "装置与因果", "串并联电路", "互动电路实验", "candidate", "", "九年级", "通过接线和仪表测量理解串并联电路规律", "必须在可控装置中建立接线与测量结果的因果关系", "连接器材、闭合开关、读取电流电压", "CircuitJS1", "mindmap"),
  ]),
  subject("化学", "实验现象、反应规则与微观结构", [
    example("chemistry-titration", "实验参数", "强酸强碱滴定", "酸碱滴定实验", "ready", "acid_base_lab", "高二", "理解滴加体积、pH、等当点和指示剂颜色的关系", "需要连续控制滴加量并观察可计算结果", "控制滴加量，观察 pH 与颜色变化"),
    example("chemistry-equation", "记忆与辨析", "化学方程式的条件与现象", "概念翻转卡", "ready", "concept_cards", "九年级", "辨析常见反应的反应物、条件、现象和生成物", "容易遗漏的条件和现象适合反复召回", "看反应物预测条件与现象，翻卡核对"),
    example("chemistry-molecule", "空间结构", "分子结构与化学键", "3D 分子模型", "candidate", "", "高一", "观察常见分子的键角、空间构型和极性", "平面图难以传达三维键角与对称性", "旋转、缩放并点选原子与化学键", "3Dmol.js", "concept_cards"),
  ]),
  subject("生物", "生命结构、过程、分类与生态关系", [
    example("biology-cell", "分类与层级", "细胞结构与功能", "互动思维导图", "ready", "mindmap", "七年级", "建立细胞器结构、功能和所在细胞类型的联系", "多个部件围绕同一系统形成层级关系", "点选细胞器节点，查看结构与功能"),
    example("biology-division", "记忆与对比", "有丝分裂与减数分裂", "概念翻转卡", "ready", "concept_cards", "高一", "对比两种细胞分裂的场所、过程与结果", "相似概念包含多组易混属性", "先判断特征归属，再翻卡核对依据"),
    example("biology-ecosystem", "关系与影响", "食物网与生态系统", "互动关系网络", "candidate", "", "八年级", "分析某个物种变化时食物网的上下游影响", "多个对象间存在非树形的双向影响", "隐藏或恢复物种，观察相关群落变化", "React Flow", "mindmap"),
  ]),
  subject("历史", "时间顺序、因果链、人物与史料证据", [
    example("history-cause", "因果与结构", "工业革命的原因与影响", "互动思维导图", "ready", "mindmap", "九年级", "从技术、生产、城市与社会关系梳理工业革命的影响", "原因和影响可以组织为多层因果框架", "逐层展开因素，区分直接与深层影响"),
    example("history-figures", "记忆与匹配", "历史人物、主张与贡献", "概念翻转卡", "ready", "concept_cards", "七年级", "把中国古代思想家与核心主张、时代背景相匹配", "人物、时代和贡献需要建立稳定联系", "看人物回忆主张，翻卡查看证据"),
    example("history-timeline", "时间先后", "中国近代史重要事件", "互动时间轴", "candidate", "", "八年级", "把重要事件放入时间顺序并理解前后联系", "时序和同期横向对比是理解的核心", "按年份浏览，对比同期国内外事件", "Mermaid", "mindmap"),
  ]),
  subject("地理", "空间分布、地理过程与区域数据", [
    example("geography-climate", "因果与层级", "东亚季风气候成因", "互动思维导图", "ready", "mindmap", "八年级", "从海陆热力性质、风向和水汽来源解释季风气候", "多个因素形成可展开的因果链", "展开夏季与冬季分支，对比风向与降水"),
    example("geography-map", "空间分布", "中国地形、气候与河流", "互动地图", "candidate", "", "八年级", "比较地形阶梯、气候分区和主要河流的空间关系", "知识本质是图层叠加和区域位置判断", "开关图层，点选区域查看特征", "ECharts", "mindmap"),
    example("geography-data", "数据与证据", "人口、城市化与经济数据", "互动数据图表", "candidate", "", "高一", "筛选区域和年份，判读人口与城市化变化趋势", "结论需要建立在可筛选和对比的数据上", "选择区域、改变年份、查看趋势与异常", "Apache ECharts", "concept_cards"),
  ]),
  subject("道德与法治 / 思想政治", "核心概念、制度关系与情境判断", [
    example("politics-rights", "记忆与辨析", "公民权利与义务", "概念翻转卡", "ready", "concept_cards", "八年级", "在具体生活案例中区分权利、义务与正确行使方式", "概念容易在情境中混淆，需要反复判断", "先对案例定性，再翻卡查看依据"),
    example("politics-institution", "分类与关系", "国家机构与职能", "互动思维导图", "ready", "mindmap", "八年级", "梳理国家机构的性质、职权和相互关系", "多个机构存在层级和职权分工", "展开机构节点，对比职权与关系"),
    example("politics-debate", "观点与证据", "公共议题论证", "交互论证图", "candidate", "", "高一", "区分公共议题中的观点、证据、反例和结论", "重点是证据如何支撑或削弱观点", "拖动证据到对应观点，检查论证链", "React Flow", "mindmap"),
  ]),
  subject("信息科技", "代码执行、算法过程与系统结构", [
    example("it-security", "分类与辨析", "网络结构与信息安全", "互动思维导图", "ready", "mindmap", "八年级", "梳理网络设备、协议、常见风险与防护方法", "概念形成设备、通信和安全多层结构", "展开节点，查看风险与防护对应关系"),
    example("it-concepts", "记忆与辨析", "变量、条件与循环", "概念翻转卡", "ready", "concept_cards", "七年级", "用小程序片段辨析变量、分支条件和循环次数", "编程基础术语需要与典型例子稳定配对", "看代码片段预测术语，翻卡核对"),
    example("it-sort", "算法与过程", "排序算法", "算法单步动画", "candidate", "", "高一", "观察比较、交换和已完成区间的变化", "理解来自每一次状态转换而非最终结果", "调整输入，逐步执行并查看比较次数", "Motion Canvas", "mindmap"),
  ]),
  subject("通用技术", "设计过程、结构原理与技术试验", [
    example("technology-design", "步骤与迭代", "技术设计的一般过程", "互动思维导图", "ready", "mindmap", "高一", "梳理发现问题、设计方案、制作模型、测试与改进的迭代关系", "设计任务包含稳定阶段与可反复迭代的分支", "展开设计阶段，查看每阶段产出和评价依据"),
    example("technology-structure", "记忆与辨析", "结构的稳定性与强度", "概念翻转卡", "ready", "concept_cards", "高一", "在桥梁、支架等实例中辨析重心、支撑面、材料和构件形状的影响", "多个稳定性因素需要与工程实例反复配对", "看结构实例预测风险，翻卡核对原理"),
    example("technology-mechanism", "空间与运动", "简单机械机构与传动", "3D 机构实验", "candidate", "", "高一", "观察齿轮、连杆和凸轮机构的运动转换与传动比", "理解依赖连续运动、空间结构和确定性约束", "旋转模型、改变尺寸，观察从动件运动", "Three.js", "mindmap"),
  ]),
  subject("科学（小学综合）", "可观察现象、探究实验与生活分类", [
    example("science-classify", "分类与层级", "常见材料的性质与用途", "互动思维导图", "ready", "mindmap", "小学", "按来源、硬度、导电性和用途对常见材料分类", "适合用层级结构建立多种分类标准", "展开不同标准，比较同一材料的归类"),
    example("science-throw", "参数与实验", "投掷角度与距离", "抛体运动实验", "ready", "projectile_lab", "小学", "在同样初速度下比较不同投掷角度的轨迹和距离", "学生可以使用控制变量方法做预测与观察", "保持初速度，改变角度并记录射程"),
    example("science-shadow", "空间与现象", "光与影子的关系", "几何光学实验", "candidate", "", "小学", "观察光源、物体和光屏位置对影子大小的影响", "三个对象的空间位置共同决定可观察结果", "移动光源或物体，测量影子变化", "PhET Simulations", "mindmap"),
  ]),
  subject("音乐", "符号记忆、曲式结构与听觉节奏", [
    example("music-symbols", "记忆与辨析", "音符、休止符与力度记号", "概念翻转卡", "ready", "concept_cards", "小学", "识别基本乐谱符号并说出对应时值或演奏要求", "图形符号和含义需要快速召回", "看符号猜含义，翻卡查看演奏要点"),
    example("music-form", "分类与结构", "乐曲段落与曲式", "互动思维导图", "ready", "mindmap", "七年级", "识别乐曲的主题、变奏、对比段与再现结构", "曲式是有层级的段落和主题关系", "展开段落节点，对比各段主题特征"),
    example("music-rhythm", "听说与节奏", "节拍与节奏", "互动节奏练习", "candidate", "", "小学", "感受不同速度和节拍，稳定跟随节奏点击", "节奏需要听觉时间参照与动作反馈", "调整速度、跟拍点击、查看偏差", "Motion Canvas", "concept_cards"),
  ]),
  subject("美术", "风格辨析、视觉构成与动手技法", [
    example("art-history", "记忆与对比", "艺术流派与代表作品", "概念翻转卡", "ready", "concept_cards", "八年级", "对比印象派、立体主义等流派的视觉特征与代表作", "风格、时期、艺术家和作品需要稳定匹配", "看作品局部判断风格，翻卡核对"),
    example("art-composition", "分类与构成", "构图的对称、对比与节奏", "互动思维导图", "ready", "mindmap", "七年级", "梳理常见构图原则、视觉效果和适用场景", "视觉原则可按特征与效果组织为层级", "展开构图原则，查看效果与作品例子"),
    example("art-color", "参数与创作", "三原色与色彩混合", "互动色彩画布", "candidate", "", "小学", "调节不同色彩比例，观察混色结果与冷暖变化", "结果由可连续调节的色彩参数决定", "拖动颜色比例，取样并保存色卡", "Excalidraw", "concept_cards"),
  ]),
  subject("体育与健康", "动作技能、运动规则与健康决策", [
    example("pe-rules", "分类与战术", "篮球基本规则与攻防位置", "互动思维导图", "ready", "mindmap", "七年级", "梳理违例、犯规、得分与基本攻防分工", "规则和战术位置适合用分支建立整体框架", "展开规则与位置分支，查看情境例子"),
    example("pe-health", "记忆与判断", "营养、急救与健康习惯", "概念翻转卡", "ready", "concept_cards", "八年级", "在生活情境中判断合理营养、运动损伤处理与健康习惯", "健康知识需要快速回忆并迁移到情境", "先判断处理方案，再翻卡查看原则"),
    example("pe-motion", "动作与模仿", "篮球投篮与体操动作", "分步动作视频", "candidate", "", "八年级", "识别准备、发力、出手和落地阶段的关键姿势", "动作技能必须通过时间连续的视觉模仿学习", "慢放、逐帧查看、对照关键姿势", "Remotion", "concept_cards"),
  ]),
  subject("劳动与综合实践", "安全规范、操作步骤与项目协作", [
    example("labor-steps", "步骤与流程", "蔬菜种植与日常管理", "互动思维导图", "ready", "mindmap", "小学", "掌握选种、播种、浇水、观察和采收的周期与要点", "任务包含有顺序的阶段和每阶段注意事项", "展开阶段节点，查看工具、方法和记录要求"),
    example("labor-safety", "记忆与判断", "劳动工具使用与安全", "概念翻转卡", "ready", "concept_cards", "小学", "根据工具和操作场景选择正确防护与使用方法", "安全规则必须在具体情境中被准确召回", "看场景判断风险，翻卡查看正确做法"),
    example("labor-project", "项目与协作", "校园节水改造项目", "分支项目任务", "candidate", "", "八年级", "完成问题调查、方案比较、分工实施和效果评估", "项目包含多角色、多阶段和条件分支", "选择任务分支，提交阶段成果并查看反馈", "H5P", "mindmap"),
  ]),
]);

export function initGenerationGuidance(options = {}) {
  const root = options.root || document.querySelector("#interactiveLessonWorkspace");
  if (!root || root.dataset.generationGuidanceReady === "true") return null;
  const trigger = root.querySelector("#generationGuidanceOpen");
  const dialog = root.querySelector("#generationGuidanceDialog");
  const closeButton = root.querySelector("#generationGuidanceClose");
  const search = root.querySelector("#generationGuidanceSearch");
  const statusFilter = root.querySelector("#generationGuidanceStatus");
  const subjectFilters = root.querySelector("#generationGuidanceSubjects");
  const grid = root.querySelector("#generationGuidanceGrid");
  const resultCount = root.querySelector("#generationGuidanceCount");
  const surface = dialog?.querySelector(".generation-guidance-surface");
  if (!trigger || !dialog || !search || !statusFilter || !subjectFilters || !grid) return null;
  root.dataset.generationGuidanceReady = "true";

  const examplesById = new Map(GENERATION_GUIDANCE.flatMap((subjectItem) =>
    subjectItem.examples.map((item) => [item.id, Object.freeze({ ...item, subject: subjectItem.name })])));
  const state = { subject: "", query: "", status: "" };
  let returnFocus = null;

  subjectFilters.innerHTML = [
    '<button type="button" class="is-active" data-guidance-subject="">全部学科</button>',
    ...GENERATION_GUIDANCE.map((item) => `<button type="button" data-guidance-subject="${escapeHtml(item.name)}">${escapeHtml(item.name)}</button>`),
  ].join("");

  const render = () => {
    const query = state.query.trim().toLowerCase();
    let visibleExampleCount = 0;
    const visibleSubjects = GENERATION_GUIDANCE.map((item) => {
      if (state.subject && item.name !== state.subject) return null;
      const examples = item.examples.filter((entry) => {
        if (state.status && entry.status !== state.status) return false;
        if (!query) return true;
        return [item.name, item.summary, entry.trait, entry.knowledgePoint, entry.carrier, entry.goal, entry.reason, entry.interaction]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
      if (examples.length === 0) return null;
      visibleExampleCount += examples.length;
      return { ...item, examples };
    }).filter(Boolean);

    resultCount.textContent = `显示 ${visibleSubjects.length} 个学科 · ${visibleExampleCount} 个示例`;
    grid.innerHTML = visibleSubjects.length
      ? visibleSubjects.map(renderSubject).join("")
      : '<div class="generation-guidance-empty"><i data-lucide="search-x"></i><b>没有找到匹配示例</b><p>试试搜索“参数”、“时间”、“空间”或切换能力状态。</p></div>';
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  };

  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  trigger.addEventListener("click", () => {
    returnFocus = trigger;
    state.subject = "";
    state.query = "";
    state.status = "";
    search.value = "";
    statusFilter.value = "";
    subjectFilters.querySelectorAll("[data-guidance-subject]").forEach((item) =>
      item.classList.toggle("is-active", item.dataset.guidanceSubject === ""));
    render();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    queueMicrotask(() => {
      if (surface) surface.scrollTop = 0;
      closeButton?.focus();
    });
  });
  closeButton?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("close", () => {
    const focusTarget = returnFocus;
    returnFocus = null;
    queueMicrotask(() => focusTarget?.focus?.());
  });
  search.addEventListener("input", () => { state.query = search.value; render(); });
  statusFilter.addEventListener("change", () => { state.status = statusFilter.value; render(); });
  subjectFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-guidance-subject]");
    if (!button) return;
    state.subject = button.dataset.guidanceSubject || "";
    subjectFilters.querySelectorAll("[data-guidance-subject]").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
  grid.addEventListener("click", (event) => {
    const useButton = event.target.closest("[data-use-guidance]");
    if (useButton) {
      const item = examplesById.get(useButton.dataset.useGuidance);
      if (item) {
        options.onUseExample?.(item, useButton.dataset.useMode || "primary");
        close();
      }
      return;
    }
    const technologyButton = event.target.closest("[data-guidance-technology]");
    if (technologyButton) {
      const item = examplesById.get(technologyButton.dataset.guidanceTechnology);
      if (item) {
        options.onExploreTechnology?.(item);
        close();
      }
    }
  });

  render();
  return Object.freeze({ open: () => trigger.click(), render, guidance: GENERATION_GUIDANCE });
}

function renderSubject(subjectItem) {
  return `<article class="generation-subject-card">
    <header><div><span>${escapeHtml(subjectItem.name.slice(0, 1))}</span><div><h3>${escapeHtml(subjectItem.name)}</h3><p>${escapeHtml(subjectItem.summary)}</p></div></div><em>${subjectItem.examples.length} 个示例</em></header>
    <div class="generation-example-list">${subjectItem.examples.map(renderExample).join("")}</div>
  </article>`;
}

function renderExample(item) {
  const ready = item.status === "ready";
  const action = ready
    ? `<button type="button" class="generation-example-primary" data-use-guidance="${item.id}"><i data-lucide="arrow-down-to-line"></i>带入生成</button>`
    : `<button type="button" class="generation-example-secondary" data-use-guidance="${item.id}" data-use-mode="fallback"><i data-lucide="replace"></i>用${escapeHtml(ARTIFACT_LABELS[item.fallbackArtifact] || "现有载体")}替代</button><button type="button" class="generation-example-tech" data-guidance-technology="${item.id}"><i data-lucide="waypoints"></i>查看技术</button>`;
  return `<section class="generation-example" data-status="${item.status}">
    <div class="generation-example-top"><span>${escapeHtml(item.trait)}</span><em>${STATUS_LABELS[item.status]}</em></div>
    <h4>${escapeHtml(item.knowledgePoint)}</h4>
    <div class="generation-carrier"><span>推荐载体</span><b>${escapeHtml(item.carrier)}</b></div>
    <p><b>为什么：</b>${escapeHtml(item.reason)}</p>
    <p><b>怎么学：</b>${escapeHtml(item.interaction)}</p>
    <footer><small>${escapeHtml(item.grade)} · ${escapeHtml(item.goal)}</small><div>${action}</div></footer>
  </section>`;
}

function subject(name, summary, examples) {
  return Object.freeze({ name, summary, examples: Object.freeze(examples) });
}

function example(id, trait, knowledgePoint, carrier, status, artifact, grade, goal, reason, interaction, technology = "", fallbackArtifact = "") {
  return Object.freeze({ id, trait, knowledgePoint, carrier, status, artifact, grade, goal, reason, interaction, technology, fallbackArtifact });
}

function physicsExample(physicsPreset, physicsEngine, id, trait, knowledgePoint, grade, goal, reason, interaction) {
  return Object.freeze({
    ...example(id, trait, knowledgePoint, "物理参数实验", "ready", "physics_lab", grade, goal, reason, interaction),
    physicsPreset,
    physicsEngine,
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
