# AI 教师 MVP 2.0 字段与英文术语表

> 配套文档：`AI-Teacher-MVP-2.0-PRD.md`  
> 用途：把 PRD 中的对象名、JSON 字段、参数名、枚举值、错误码和技术缩写翻译成可直接评审的中文。  
> 说明：`turn_008`、`tenant_01` 等具体示例 ID 不逐个当作字段解释，其命名规律见第 14 节。

## 0. 先掌握这 10 个核心概念

| 英文词 | 中文含义 | 一句话理解 |
|---|---|---|
| `teacher_turn` | 教学回合工具 | 双工模型唯一能调用的教育工具，所有教学逻辑都从这里进入。 |
| `teacher-agent` | 教学编排模块 | 当前代码中实现 `teacher_turn`、状态、召回编排和教学结果生成的服务模块。 |
| `SemanticHint@2.0` | 语义提示 2.0 | 双工模型对“用户想做什么、原话里说了什么”的非权威理解。 |
| `ResolvedIntent@2.0` | 权威意图结果 2.0 | 服务端校验模型提示并结合状态后得到的最终执行决定。 |
| `RetrievalPlan@2.0` | 召回计划 2.0 | 服务端发送给知识检索系统的完整查询计划。 |
| `KnowledgeRetrievalResponse@2.0` | 知识召回响应 2.0 | 外部知识服务返回的标准结果。 |
| `TeachingPackage` | 教学结果包 | 同一回合唯一的权威教学结果，语音和页面都从它派生。 |
| `VoiceProjection` | 语音投影 | 从教学结果包中裁剪给双工模型说话的内容。 |
| `UIProjection` | 页面投影 | 从教学结果包中裁剪给页面渲染卡片的数据。 |
| `Turn Resolver` | 回合解析器 | 合并原话、模型提示和会话状态，决定走哪条处理链路。 |
| `Provider / Retriever` | 外部服务适配器 / 检索器 | 在权限范围内执行元数据过滤、关键词和向量混合检索。 |

## 1. 字段名的通用阅读规则

| 写法 | 中文含义 | 示例 |
|---|---|---|
| `_id` | 单个唯一编号 | `document_id`：文档编号 |
| `_ids` | 多个唯一编号组成的数组 | `course_ids`：课程编号列表 |
| `_version` | 协议、对象或算法版本 | `schema_version` |
| `_at` | 一个时间点，通常使用带时区时间戳 | `published_at` |
| `_start_at / _end_at` | 时间范围的开始与结束 | `event_start_at / event_end_at` |
| `_ms` | 毫秒 | `timeout_ms` |
| `_count` | 数量 | `token_count` |
| `_k` | 检索阶段保留的前 K 条数量 | `top_k` |
| `_ref` | 指向另一个对象的引用 | `public_resource_ref` |
| `_refs` | 多个对象引用 | `evidence_refs` |
| `is_` | 布尔判断，取 `true / false` | `is_current` |
| `*_before / *_after` | 执行前与执行后的值 | `state_version_before / state_version_after` |
| `a.b` | JSON 对象中的嵌套路径 | `grounding.mode` |
| `null` | 当前没有值或对象 | `active_quiz: null` 表示没有活动题 |
| `true / false` | 是 / 否 | `enabled: true` 表示启用 |

## 2. 系统组件、对象和合同名称

| 英文名称 | 中文含义 | 在 MVP 2.0 中的职责 |
|---|---|---|
| `UserTurn` | 用户回合对象 | 表示一次经过网关确认的语音、文字或页面操作。 |
| `UIAction` | 页面操作事件 | 用户点击选项、提交答案等结构化页面事件。 |
| `Gateway` | 网关 / 回合协调层 | 产生权威回合编号，负责排队、取消、过期丢弃和结果分发。 |
| `Voice Gateway` | 语音网关 | 连接双工语音模型和教学服务。 |
| `Turn Coordinator` | 回合协调器 | 保证回合顺序、幂等和取消语义正确。 |
| `Turn Resolver` | 回合解析器 | 解析路由、教学动作、槽位和上下文依赖。 |
| `Session State Store` | 会话状态存储 | 保存活动主题、活动题、状态版本等服务端权威状态。 |
| `Retrieval Planner` | 召回计划生成器 | 把权威意图转换成查询、硬过滤、软偏好和排序参数。 |
| `RetrieverPort` | 检索器抽象接口 | 让 Mock 和真实知识服务可以互换，而不改上层业务。 |
| `MockKnowledgeProvider` | 模拟知识服务 | MVP 1.0 的固定测试实现。 |
| `mockKnowledgeProvider` | 模拟知识服务实例 | 代码中 `MockKnowledgeProvider` 的具体单例变量名。 |
| `HttpKnowledgeProvider` | HTTP 知识服务适配器 | 调用真实外部知识接口并映射成本系统协议。 |
| `External Retriever` | 外部检索服务 | 执行过滤、关键词召回、向量召回、融合和排序。 |
| `Result Normalizer` | 结果标准化器 | 校验外部响应并转换为内部统一结构。 |
| `Repository Hydrator` | 仓库对象补全器 | 根据返回的 ID 和版本加载本地完整权威对象。 |
| `Repository` | 权威对象仓库 | 按精确 ID 和版本保存、读取知识、素材或私有答案。 |
| `Knowledge Repositories` | 知识对象仓库集合 | Document、Claim、Evidence、Material 等权威存储的统称。 |
| `Teaching Policy` | 教学策略 | 决定使用哪些事实、是否澄清、如何降级。 |
| `Claim Selector` | 事实选择器 | 从命中结果中选择可用于本轮回答的 Claim。 |
| `Assessment Engine` | 判题引擎 | 使用固定题目 ID 和版本进行确定性判题。 |
| `Card Assembler` | 卡片组装器 | 从教学素材或公开题面生成符合 Schema 的教育卡片。 |
| `A2UIRenderer` | Agent 到 UI 渲染器 | 把页面投影渲染成确定性的教育卡片。 |
| `EducationCard` | 教育卡片协议对象 | 页面最终消费的卡片 JSON。 |
| `EducationCards` | 教育卡片集合 | 一个教学结果包中可展示的卡片数组。 |
| `CardInstance` | 卡片实例 | 按当前回合动态生成的卡片；不能作为知识索引内容。 |
| `TeachingPackage@1.0` | 教学结果包 1.0 | 服务端一次教学回合的统一权威结果。 |
| `VoiceProjection@1.0` | 语音投影 1.0 | 给双工模型消费的受控回答内容。 |
| `UIProjection@1.0` | 页面投影 1.0 | 给页面消费的确定性卡片和状态。 |
| `Feature Flag` | 功能开关 | 按 Session 决定使用 Mock 还是真实 Provider。 |
| `Index Snapshot` | 索引快照 | 某一时刻不可变、可整体切换的检索索引版本。 |
| `Tombstone` | 删除墓碑标记 | 先阻断已删除对象访问，再异步清理索引和文件。 |
| `Registry Schema` | 卡片注册表结构规范 | 规定每种卡片允许的字段和版本。 |

## 3. `SemanticHint@2.0`：双工模型输出字段

| 字段路径 | 中文含义 | 用途 |
|---|---|---|
| `schema_version` | 结构协议版本 | 标明当前 JSON 遵循哪个版本。 |
| `route_hint` | 路由提示 | 双工模型认为本轮大致属于知识、状态动作、对话或澄清。 |
| `pedagogical_act` | 教学动作 | 用户希望老师做什么，例如讲解、复习、出题或提示。 |
| `query_text` | 原话中的查询文本 | 只保留用户明确说出的可查询词。 |
| `context_dependency` | 上下文依赖程度 | 判断本轮是否必须从前文补充主题或范围。 |
| `presentation_goal` | 展示目标对象 | 描述用户希望怎么呈现内容。 |
| `card_type` | 卡片类型 | 期望使用的卡片 Registry 类型。 |
| `surface_slots` | 表面槽位数组 | 用户原话中直接出现、尚未映射成内部 ID 的内容。 |
| `action` | 结构化动作提示 | 可选动作对象；`null` 表示没有。具体子结构尚未冻结。 |
| `confidence` | 置信度 | 模型对提示的自评，不能替代服务端校验。 |
| `semantic_hint` | 语义提示参数 | `teacher_turn` 接收 `SemanticHint@2.0` 时使用的参数名。 |
| `surface` | 表面表达 | 原话中的词，例如“牛二”“上周”，尚未归一化。 |
| `topic_surface` | 主题表面词 | 原话中的主题表达，例如“牛二”。 |
| `source_surface` | 来源表面词 | 原话中的来源表达，例如“课堂讲过的”。 |
| `time_surface` | 时间表面词 | 原话中的时间表达，例如“上周”。 |

## 4. `ResolvedIntent@2.0`：服务端权威意图字段

| 字段路径 | 中文含义 | 用途 |
|---|---|---|
| `turn_id` | 回合编号 | 唯一标识当前用户回合。 |
| `decision` | 执行决策 | 决定本轮召回、处理状态、普通对话还是澄清。 |
| `ResolvedIntent.decision` | 权威意图中的执行决策 | `decision` 的完整字段路径写法。 |
| `route` | 业务路由 | 标记本轮属于哪条业务链路。 |
| `pedagogical_act` | 教学动作 | 服务端最终确认的讲解、出题、作答等动作。 |
| `query` | 查询对象 | 包含原话、规范化文本和语义补全后的查询。 |
| `raw_text` | 用户原始文本 | ASR 最终文本或文字输入原文。 |
| `normalized_text` | 规范化文本 | 对空格、符号、常见错词等做确定性清洗后的文本。 |
| `semantic_query` | 语义补全查询 | 结合上下文形成的完整查询。 |
| `topic` | 主题对象 | 保存主题解析状态、知识点 ID 和来源。 |
| `status` | 状态 | 在不同对象中分别表示主题状态或 Provider 响应状态。 |
| `knowledge_point_id` | 单个知识点编号 | 精确指定一个知识点。 |
| `knowledge_point_ids` | 知识点编号列表 | 允许一个对象绑定多个知识点。 |
| `source` | 值的来源 | 说明主题、槽位或过滤条件从哪里得到。 |
| `source_turn_id` | 来源回合编号 | 条件来自历史上下文时，记录具体回合。 |
| `slots` | 权威槽位数组 | 服务端已归一化、可执行的参数集合。 |
| `name` | 槽位名称 | 表示该槽位控制的字段。 |
| `value` | 槽位值 | 标准化值或内部 ID。 |
| `enforcement` | 约束强度 | 标记条件是硬约束还是软偏好。 |
| `object_type` | 对象类型 | 例如题目、知识单元或来源片段。 |
| `question_type` | 题型 | 例如单选题、多选题。 |
| `clarification` | 澄清信息 | 需要追问时保存原因和问题；`null` 表示不需要。 |

### 4.1 路由、教学动作、展示目标和执行决策

| 所属字段 | 英文枚举值 | 中文含义 |
|---|---|---|
| `route` | `conversation` | 普通对话，不需要知识召回或状态事务。 |
| `route` | `knowledge` | 知识型回合，需要讲解、复习、找资料或出题。 |
| `route` | `state_action` | 状态型回合，例如提交答案或请求当前题提示。 |
| `route` | `clarify` | 信息不足，需要先澄清。 |
| `decision` | `retrieve` | 生成召回计划并调用知识接口。 |
| `decision` | `state_action` | 处理当前活动任务，知识召回为 0 次。 |
| `decision` | `conversation` | 直接走普通对话。 |
| `decision` | `clarify` | 先询问最少必要信息。 |
| `pedagogical_act` | `explain` | 讲解知识点。 |
| `pedagogical_act` | `define` | 给出概念定义。 |
| `pedagogical_act` | `compare` | 比较多个概念或对象。 |
| `pedagogical_act` | `solve` | 解题或演算。 |
| `pedagogical_act` | `summarize` | 总结内容。 |
| `pedagogical_act` | `review` | 复习内容。 |
| `pedagogical_act` | `quiz_generate` | 获取或生成一道练习题。 |
| `pedagogical_act` | `quiz_answer` | 回答当前活动题。 |
| `pedagogical_act` | `hint` | 请求当前题提示；与模型语义提示 `SemanticHint` 不是一回事。 |
| `pedagogical_act` | `resource_find` | 查找课件、录音、视频等学习资源。 |
| `pedagogical_act` | `task_control` | 继续、结束、换一道等任务控制。 |
| `presentation_goal` | `voice_only` | 只语音表达，不生成可视卡片。 |
| `presentation_goal` | `explanation` | 展示讲解型内容。 |
| `presentation_goal` | `mindmap` | 展示思维导图。 |
| `presentation_goal` | `image` | 展示图片。 |
| `presentation_goal` | `video` | 展示视频。 |
| `presentation_goal` | `quiz` | 展示题目卡片。 |
| `presentation_goal` | `oral_practice` | 进入口语练习。 |
| `context_dependency` | `required` | 当前表达必须依赖前文才能完整理解。 |
| `topic.status` | `resolved` | 主题已经成功映射为标准知识范围。 |

### 4.2 条件来源和约束强度

| 英文枚举值 | 中文含义 | 是否可直接成为硬约束 |
|---|---|---:|
| `server_auth` | 服务端身份和权限系统 | 是 |
| `ui_action` | 已校验的页面结构化操作 | 是 |
| `explicit_user` | 用户在原话中明确表达并被确定性解析 | 是 |
| `server_state` | 服务端活动主题、活动题等权威状态 | 是 |
| `resolved_context` | 已被服务端确认的上下文 | 是 |
| `semantic_hint` | 双工模型给出的非权威语义提示 | 默认否 |
| `retrieval_inference` | 从召回候选推断出的信息 | 否 |
| `resolver_policy` | 由已确认教学动作推导出的固定 Resolver 规则 | 限定字段可用 |
| `system_policy` | 发布状态、安全域等不可被模型修改的系统策略 | 是 |
| `recent_context` | 最近有效上下文 | 经状态校验后可用 |
| `must` | 必须满足的硬约束 | 是 |
| `prefer` | 优先满足的软偏好 | 否 |
| `must_not` | 必须排除的条件 | 是，含义为禁止 |

## 5. 会话状态、幂等、取消和判题字段

| 字段或参数 | 中文含义 | 用途 |
|---|---|---|
| `session_id` | 会话编号 | 标识一段连续教学会话。 |
| `idempotency_key` | 幂等键 | 重复请求只执行一次并返回首次结果。 |
| `last_turn_sequence` | 最近已接受回合序号 | 防止旧回合覆盖新回合。 |
| `turn_sequence` | 回合顺序号 | 判断结果是否已经过期。 |
| `state_version` | 状态版本 | 每次成功状态提交后递增，用于并发控制。 |
| `state_version_before` | 执行前状态版本 | 用于审计和回放。 |
| `state_version_after` | 执行后状态版本 | 确认本轮状态事务结果。 |
| `active_topic` | 当前活动主题 | 供“给我题目”“再讲一下”等省略表达继承。 |
| `chapter_id` | 章节编号 | 当前主题所属章节。 |
| `established_turn_sequence` | 主题建立回合序号 | 记录主题在哪一轮被确立。 |
| `expires_at` | 过期时间 | 到期后不再自动继承主题。 |
| `last_retrieval_scope` | 最近召回范围 | 保存上一轮资料类型、课程、课节和时间范围。 |
| `source_types` | 来源类型列表 | 例如课本和课件。 |
| `course_id` | 单个课程编号 | 当前查询或会话的课程范围。 |
| `lesson_id` | 课节编号 | 对应具体一次教学课节。 |
| `event_time_range` | 事件时间范围 | 用于“上周课堂”等查询。 |
| `active_quiz` | 当前活动题 | 固定当前题目编号、版本和作答状态。 |
| `exam` | 当前考试状态 | 预留或保存考试型任务。 |
| `oral_practice` | 当前口语练习状态 | 保存正在进行的口语任务。 |
| `last_package_id` | 最近教学包编号 | 关联最近成功生成的教学结果。 |
| `context_policy_id` | 上下文策略编号 | 指定主题继承和过期规则。 |
| `package_id` | 教学结果包编号 | 唯一关联语音、页面和状态变化。 |
| `duplex_response_id` | 双工响应编号 | 把教学包关联到具体语音响应。 |
| `canceled` | 已取消 | 用户打断或系统取消了当前回合。 |
| `stale` | 已过期 | 结果晚到，不能再应用到当前页面和状态。 |
| `duplicate` | 重复请求 | 被幂等机制识别为重复操作。 |
| `answer.select` | 用户选择的选项 | 例如用户选择 `A`。 |
| `assessment_item_id` | 题目编号 | 精确定位公开题面和私有答案。 |
| `item_version` | 题目版本 | 判题必须使用出题时固定的版本。 |
| `correct_response` | 正确答案 | 只能从私有答案域读取。 |
| `grade_answer` | 判题服务动作 | 对用户回答进行确定性判题。 |
| `load_assessment_key` | 加载私有答案动作 | 按题目编号和版本读取答案。 |
| `get_or_update_learning_state` | 读取或更新学习状态动作 | 内部状态服务能力，不对双工模型暴露。 |

## 6. `RetrievalPlan@2.0` 请求字段

| 字段路径 | 中文含义 | 用途 |
|---|---|---|
| `plan_version` | 召回计划协议版本 | 用于兼容和 Schema 校验。 |
| `request_id` | 外部请求编号 | 关联一次 Provider 请求和响应。 |
| `plan_id` | 内部召回计划编号 | 关联意图解析、日志、调用和回放。 |
| `principal_context_id` | 权限上下文编号 | 服务端签发的不透明授权引用，模型和客户端不能修改。 |
| `targets` | 检索目标对象 | 描述本次要搜索哪类对象。 |
| `object_types` | 对象类型列表 | 例如只搜索题目，不搜索普通 Chunk。 |
| `query` | 查询对象 | 保存原话、语义补全和关键词。 |
| `semantic_text` | 语义补全后的查询文本 | 给向量检索使用的完整语义查询。 |
| `lexical_terms` | 关键词列表 | 给关键词或 BM25 检索使用。 |
| `rewrite_provenance` | 查询改写来源记录 | 解释补入了什么词以及来自哪一轮。 |
| `term` | 改写词 | 被补充、规范化或展开的具体词。 |
| `filters` | 元数据过滤对象 | 包含硬过滤、软偏好和禁止条件。 |
| `field` | 被过滤的字段 | 例如租户、知识点、生命周期。 |
| `op` | 比较操作符 | 指定字段和值如何比较。 |
| `value` | 比较值 | 过滤条件的目标值。 |
| `weight` | 偏好权重 | 控制某个软偏好对排序的影响。 |
| `ranking` | 排序配置 | 包含候选数、融合、重排和超时。 |
| `policy_id` | 排序策略编号 | 标记使用哪套检索排序策略。 |
| `lexical_candidate_k` | 关键词候选数 | 关键词通道最多取多少条。 |
| `dense_candidate_k` | 向量候选数 | 向量通道最多取多少条。 |
| `fusion` | 多路融合配置 | 合并关键词与向量排名。 |
| `type` | 类型鉴别字段 | 在 `fusion` 中表示算法，在 `locator` 中表示定位方式。 |
| `rank_constant` | RRF 排名平滑常数 | 调节不同排名位置的贡献差距。 |
| `rerank` | 二次重排配置 | 对融合后的少量候选重新排序。 |
| `enabled` | 是否启用 | `true` 开启，`false` 关闭。 |
| `top_k` | 取前 K 条 | 限定进入下一阶段的候选数量。 |
| `timeout_ms` | 超时时间，毫秒 | 某阶段或整个请求允许的最长耗时。 |
| `result_limit` | 最终结果上限 | Provider 最多返回多少个对象。 |
| `result_policy` | 结果使用策略 | 规定证据和答案可见性等条件。 |
| `require_evidence` | 是否必须有证据 | 为 `true` 时，无证据对象不能成为正式命中。 |
| `answer_visibility` | 答案可见策略 | 控制本轮只能获取题面还是允许读取答案域。 |
| `max_units` | 最大知识单元数 | 限制一次返回的知识单元数量。 |

### 6.1 Filter 操作符和目标对象

| 英文值 | 中文含义 | 用途 |
|---|---|---|
| `eq` | 等于 | 字段值必须与目标值相同。 |
| `contains` | 包含 | 数组或集合必须包含目标值。 |
| `in` | 属于集合 | 字段值必须落在给定集合内；作为待冻结 DSL 操作符。 |
| `range` | 范围 | 用于时间或数值区间；作为待冻结 DSL 操作符。 |
| `knowledge_unit` | 知识单元对象 | 搜索已经编译的教学语义单元。 |
| `source_chunk` | 来源片段对象 | 搜索可引用原文片段。 |
| `assessment_item` | 题目对象 | 搜索可用于练习的公开题面。 |
| `single_choice` | 单选题 | `question_type` 的一个值。 |
| `question_only` | 仅题面可见 | 召回阶段不得返回正确答案和评分规则。 |
| `rrf` | 倒数排名融合 | 以各通道排名而不是原始分数进行融合。 |

## 7. `KnowledgeRetrievalResponse@2.0` 响应字段

| 字段路径 | 中文含义 | 用途 |
|---|---|---|
| `response_version` | 响应协议版本 | 用于兼容和 Schema 校验。 |
| `retrieval_id` | 本次召回编号 | 追踪 Provider 内部执行和性能。 |
| `provider` | 召回服务提供方 | 标识结果来自哪个实现或供应商。 |
| `index_snapshot` | 索引快照编号 | 固定本次查询使用的索引版本。 |
| `retrieval_policy_version` | 检索策略版本 | 固定查询、融合和重排策略，支持回放。 |
| `degraded` | 是否发生降级 | 部分非关键阶段失败但仍能返回可靠结果。 |
| `executed_query` | 实际执行查询 | 记录 Provider 最终使用的语义文本和关键词。 |
| `matches` | 命中对象列表 | 排序后的知识对象或题目。 |
| `rank` | 排名位置 | `1` 表示第一名。 |
| `result_kind` | 结果对象类型 | 单条结果是题目、知识单元还是来源片段。 |
| `object_id` | 通用对象编号 | 稳定定位权威对象。 |
| `object_version` | 通用对象版本 | 防止加载到错误的新版本。 |
| `score` | 相关性分数 | 用于排序与诊断，不代表答案正确概率。 |
| `match_reasons` | 命中原因列表 | 说明关键词、向量或过滤条件如何促成命中。 |
| `knowledge_unit_id` | 知识单元编号 | 将结果关联到教学语义单元。 |
| `claim_refs` | Claim 引用列表 | 指向本结果支持的权威事实。 |
| `evidence_refs` | Evidence 引用列表 | 指向响应中的证据。 |
| `public_resource_ref` | 公开资源引用 | 加载公开题面或公开素材，不能指向私有答案。 |
| `presentation_candidates` | 展示候选列表 | 推荐可用的卡片或素材。 |
| `recommended_card_type` | 推荐卡片类型 | 例如推荐使用单选题卡。 |
| `supports_claim_ids` | 支持的 Claim 编号列表 | 保证卡片内容与语音事实一致。 |
| `evidence` | 证据列表 | 返回可追溯的来源片段和定位信息。 |
| `evidence_id` | 证据编号 | 唯一引用某条证据。 |
| `excerpt` | 证据摘录 | 最小必要原文片段。 |
| `excerpt_hash` | 摘录哈希 | 检查摘录是否变化并支持回放。 |
| `reason` | 未命中原因 | 查询正常执行但为空时的内部分类。 |
| `error` | 错误对象 | 技术失败时包装错误码和重试属性。 |
| `code` | 标准错误码 | 机器可处理、已脱敏的错误类型。 |
| `retryable` | 是否适合重试 | 表示稍后重试是否可能成功。 |

### 7.1 响应状态、未命中原因、错误码和命中原因

| 类别 | 英文值 | 中文含义 |
|---|---|---|
| `status` | `matched` | 查询成功并找到合格结果。 |
| `status` | `no_match` | 查询成功执行，但没有合格结果；不是系统故障。 |
| `status` | `error` | 技术、鉴权或协议错误；不能当作没有知识。 |
| `reason` | `no_relevant_result` | 没有足够相关的结果。 |
| `reason` | `filtered_out` | 候选均被权限、状态或业务条件过滤；仅供内部使用。 |
| `reason` | `unsupported_target` | Provider 不支持请求的目标对象类型。 |
| `reason` | `empty_corpus` | 当前授权范围内没有可检索语料。 |
| `error.code` | `PROVIDER_TIMEOUT` | 外部服务超时。 |
| `error.code` | `PROVIDER_UNAVAILABLE` | 外部服务不可用。 |
| `error.code` | `INVALID_RESPONSE` | 响应没有通过 Schema 或版本校验。 |
| `error.code` | `AUTH_SCOPE_INVALID` | 权限上下文缺失、过期或无效。 |
| `match_reasons` | `dense` | 由向量语义通道召回。 |
| `match_reasons` | `lexical` | 由关键词通道召回。 |
| `match_reasons` | `knowledge_point_filter` | 结果满足知识点过滤条件。 |
| `provider` | `external_hybrid` | 外部混合检索 Provider 的示例名称。 |
| `degraded_stage` | `rerank_timeout` | 二次重排超时，改用融合结果。 |

## 8. Document / Revision 通用元数据

| 字段 | 中文含义 | 用途 |
|---|---|---|
| `tenant_id` | 租户编号 | 隔离不同学校、机构或客户的数据。 |
| `namespace` | 安全命名空间 | 区分共享知识、课程私域、答案安全域和学生私域。 |
| `document_id` | 文档编号 | 跨版本稳定的逻辑文件标识。 |
| `revision_id` | 修订版本编号 | 某次不可变内容版本。 |
| `revision_no` | 修订序号 | 表示版本先后顺序。 |
| `source_type` | 来源类型 | 区分课本、课件、录音、题目等。 |
| `subtype` | 来源子类型 | 进一步区分作业任务、提交和反馈等。 |
| `title` | 标题 | 展示、关键词检索和引用。 |
| `source_system` | 来源系统 | 记录原始系统和数据血缘。 |
| `author` | 作者 | 来源说明和权威性判断。 |
| `publisher` | 出版方 | 教材来源和权威性判断。 |
| `language` | 语言 | 选择解析器、分词方式和检索范围。 |
| `mime_type` | MIME 文件类型 | 指明 PDF、PPT、音频等原始格式。 |
| `content_hash` | 内容哈希 | 完整性校验、重复检测和版本固定。 |
| `is_current` | 是否当前版本 | 默认只检索当前有效 Revision。 |
| `supersedes_revision_id` | 被替代版本编号 | 建立新旧版本关系。 |
| `subject_id` | 学科编号 | 学科过滤。 |
| `grade_id` | 年级编号 | 年级过滤。 |
| `curriculum_id` | 课程标准编号 | 区分课程标准体系。 |
| `textbook_edition_id` | 教材版本编号 | 区分教材出版社和版次。 |
| `school_id` | 学校编号 | 学校权限范围。 |
| `course_id / course_ids` | 单个课程编号 / 课程编号列表 | 查询侧通常单值，文档可绑定多个课程。 |
| `class_id / class_ids` | 单个班级编号 / 班级编号列表 | 查询侧通常单值，文档可授权多个班级。 |
| `lesson_id` | 课节编号 | 关联具体一次教学课节。 |
| `teacher_id / teacher_ids` | 单个教师编号 / 教师编号列表 | 来源侧或授权侧的教师范围。 |
| `chapter_id` | 单个章节编号 | 当前上下文或精确章节过滤。 |
| `chapter_path` | 章节层级路径 | 保存章、节等完整结构。 |
| `chapter_ancestor_ids` | 章节祖先编号列表 | 支持按整章或上级节点检索。 |
| `visibility` | 可见级别 | 表示公开、租户、课程、班级或私有。具体枚举待冻结。 |
| `access_scope_ids` | 访问范围编号列表 | 在候选生成前执行 ACL 过滤。 |
| `owner_student_id` | 所属学生编号 | 学生私有对象的所有者。 |
| `sensitivity` | 敏感等级 | 决定访问、日志和保留策略；具体枚举待冻结。 |
| `release_policy` | 发布或公开策略 | 决定内容、题目或答案何时可见。 |
| `lifecycle` | 生命周期状态 | 控制草稿、审核、发布、弃用和删除。 |
| `trust_tier` | 来源可信等级 | 用于发布门禁、排序和风险控制。 |
| `parse_status` | 解析状态 | 判断内容是否已经可编译、可发布。 |
| `ocr_confidence` | OCR 置信度 | 扫描文本质量分数。 |
| `asr_confidence` | ASR 置信度 | 录音转写质量分数。 |
| `verification_status` | 审核状态 | 区分自动生成、教师审核和出版方审核。 |
| `parser_version` | 解析器版本 | 支持回放与重编译。 |
| `chunker_version` | 切片器版本 | 固定 Chunk 生成逻辑。 |
| `embedding_version` | 向量版本 | 支持向量模型升级和索引回放。 |
| `index_build_id` | 索引构建编号 | 标记某次完整索引构建。 |
| `indexed_at` | 索引时间 | 记录对象何时进入索引。 |

### 8.1 安全命名空间、生命周期和来源类型

| 所属字段 | 英文枚举值 | 中文含义 |
|---|---|---|
| `namespace` | `shared_curriculum` | 共享课程知识域。 |
| `namespace` | `organization_or_course` | 学校、组织或课程私域。 |
| `namespace` | `assessment_secure` | 题目答案、解析和评分规则安全域。 |
| `namespace` | `student_private` | 学生作答、错题和个人档案私域。 |
| `lifecycle` | `draft` | 草稿，默认不可在线检索。 |
| `lifecycle` | `reviewed` | 已审核，但是否发布由发布流程决定。 |
| `lifecycle` | `published` | 已正式发布，可按权限检索。 |
| `lifecycle` | `deprecated` | 已弃用，不应进入新查询。 |
| `lifecycle` | `deleted` | 已删除，不得返回。 |
| `source_type` | `courseware` | 课件。 |
| `source_type` | `recording` | 课堂录音或录音转写。 |
| `source_type` | `textbook` | 课本或教材。 |
| `source_type` | `assessment` | 试卷或题目来源。 |
| `source_type` | `assignment` | 作业。 |
| `source_type` | `learning_event` | 学习事件，例如错题或一次作答。 |
| 作业 `subtype` | `submission` | 学生提交内容。 |
| 作业 `subtype` | `teacher_feedback` | 教师批改或反馈。 |

## 9. 时间字段

| 字段 | 中文含义 | 用途 |
|---|---|---|
| `created_at` | 通用创建时间 | PRD 明确指出只用它无法表达所有时间语义。 |
| `record_created_at` | 数据记录创建时间 | 运维审计。 |
| `record_updated_at` | 数据记录更新时间 | 增量同步。 |
| `ingested_at` | 入库时间 | 排查数据什么时候进入知识系统。 |
| `source_authored_at` | 内容创作时间 | 回答“今年的新教材”等问题。 |
| `published_at` | 内容发布时间 | 回答“最新发布的课件”等问题。 |
| `event_time` | 教学或事实事件时间 | 课堂、考试、录音、提交真正发生的时间统称。 |
| `event_type` | 事件类型 | 说明 `event_time` 是课堂、考试还是提交。 |
| `event_start_at` | 事件开始时间 | 数据对象上的事件时间下界。 |
| `event_end_at` | 事件结束时间 | 数据对象上的事件时间上界。 |
| `event_time_range` | 查询事件时间范围 | RetrievalPlan 或会话状态中的查询范围。 |
| `valid_from` | 有效期开始 | 选择历史教材、课程标准或规则版本。 |
| `valid_to` | 有效期结束 | 选择历史教材、课程标准或规则版本。 |
| `valid_time` | 有效时间统称 | 指 `valid_from / valid_to` 形成的时间区间。 |
| `recorded_at` | 录音发生时间 | 课堂录音过滤。 |
| `teaching_date` | 授课日期 | 把课件关联到实际课堂。 |
| `assigned_at` | 作业布置时间 | 作业生命周期。 |
| `due_at` | 作业截止时间 | 作业生命周期。 |
| `submitted_at` | 作业提交时间 | 学生提交事件。 |
| `occurred_at` | 学习事件发生时间 | 错题或作答事件。 |

## 10. 各来源类型的专属字段

| 来源 | 字段 | 中文含义与用途 |
|---|---|---|
| 课件 | `deck_version` | 课件文件版本。 |
| 课件 | `slide_no` | 课件页号，也是引用定位信息。 |
| 录音 | `recording_id` | 录音稳定编号。 |
| 录音 | `class_session_id` | 对应的课堂场次编号。 |
| 录音 | `speaker_role` | 说话人角色，例如教师或学生。 |
| 录音 | `timecode` | 录音时间码统称。 |
| 录音 | `consent_status` | 录音授权状态；具体枚举待冻结。 |
| 课本 | `isbn` | 国际标准书号。 |
| 课本 | `edition` | 教材版次。 |
| 课本 | `volume` | 上册、下册等册别。 |
| 课本 | `chapter` | 章名或章号。 |
| 课本 | `section` | 节名或节号。 |
| 课本 | `page` | 原书页码。 |
| 课本 | `curriculum_version` | 对应课程标准版本。 |
| 试卷/题目 | `exam_id` | 考试编号。 |
| 试卷/题目 | `region` | 地区。 |
| 试卷/题目 | `year` | 年份。 |
| 试卷/题目 | `question_no` | 题号。 |
| 试卷/题目 | `question_type` | 题型。 |
| 试卷/题目 | `difficulty` | 难度。 |
| 作业/学习事件 | `attempt_id` | 一次提交或作答尝试编号。 |
| 学习事件 | `student_id` | 学生编号，只能由服务端身份系统提供。 |
| 学习事件 | `wrong_answer` | 学生错误答案。 |
| 学习事件 | `misconception_ids` | 误区编号列表。 |
| 学习事件 | `mastery_status` | 掌握状态。 |

## 11. Chunk、Evidence、KnowledgeUnit 和 Claim 字段

| 字段 | 中文含义 | 用途 |
|---|---|---|
| `chunk_schema_version` | Chunk 结构版本 | 校验 Chunk JSON。 |
| `chunk_id` | 来源片段编号 | 稳定定位一个可检索原文片段。 |
| `sequence` | 片段序号 | 维护文档内的先后顺序。 |
| `parent_chunk_id` | 父片段编号 | 表达层级切片关系。 |
| `previous_chunk_id` | 前一片段编号 | 邻段扩展。 |
| `next_chunk_id` | 后一片段编号 | 邻段扩展。 |
| `locator` | 来源定位对象 | 保存页码、时间码、题号或字符范围。 |
| `page_start` | 起始页 | 跨页片段定位。 |
| `page_end` | 结束页 | 跨页片段定位。 |
| `time_start_ms` | 起始毫秒 | 录音片段定位。 |
| `time_end_ms` | 结束毫秒 | 录音片段定位。 |
| `char_start` | 起始字符偏移 | 精确文本定位。 |
| `char_end` | 结束字符偏移 | 精确文本定位。 |
| `content` | 内容对象 | 包装展示文本、检索文本、哈希和长度。 |
| `display_text` | 展示原文 | 用于引用展示和人工核验。 |
| `search_text` | 检索文本 | 经过规范化后用于关键词和向量索引。 |
| `token_count` | Token 数量 | 控制片段长度。 |
| `semantics` | 语义元数据对象 | 包装内容角色、标题路径、实体和公式。 |
| `content_role` | 内容角色 | 区分定义、解释、例题等内容用途。 |
| `heading_path` | 标题路径 | 为片段补充章节上下文。 |
| `entity_ids` | 实体编号列表 | 支持实体精确匹配和扩展。 |
| `formula_terms` | 公式词形列表 | 支持 `F=ma` 等公式精确召回。 |
| `quality` | 质量对象 | 包装权威性和解析置信度。 |
| `authority_score` | 权威性分数 | 用于质量门禁或排序。 |
| `parse_confidence` | 解析置信度 | 控制对象是否可以进入生产索引。 |
| `claim_id` | Claim 编号 | 稳定标识一个可验证教学事实。 |
| `knowledge_unit_id` | 知识单元编号 | 聚合 Chunk、Claim、素材和题目。 |
| `locator.type=page` | 单页定位 | 证据落在一个具体页码。 |
| `locator.type=page_span` | 跨页定位 | 证据跨越起始页和结束页。 |

### 11.1 知识对象名称

| 英文名称 | 中文含义 | 对象职责 |
|---|---|---|
| `SourceDocument` | 来源文档 | 保存稳定文件身份、来源、分类和 ACL。 |
| `DocumentRevision` | 文档修订版本 | 保存一次不可变内容版本。 |
| `SourceChunk` | 来源片段 | 保存可检索、可精确引用的原文。 |
| `KnowledgeUnit` | 知识单元 | 面向教学组织的概念、关系、例题或误区。 |
| `Claim` | 事实声明 | 可被 Evidence 支持、可约束回答的原子事实。 |
| `Evidence` | 证据 | 将 Claim 绑定到具体文档版本和原文位置。 |
| `PresentationCandidate` | 展示候选 | 将知识单元关联到推荐卡型或素材。 |
| `TeachingMaterial` | 教学素材 | 版本化、可组卡的结构化教学内容。 |

## 12. Material、Assessment、Card 和学习事件字段

| 字段或对象 | 中文含义 | 用途 |
|---|---|---|
| `material_id` | 教学素材编号 | 按精确编号从素材仓库加载。 |
| `material_version` | 教学素材版本 | 固定展示内容并支持回放。 |
| `supported_card_types` | 支持的卡片类型列表 | 声明素材能生成哪些卡片。 |
| `response_type` | 作答方式 | 描述题目如何作答；具体枚举待冻结。 |
| `explanation` | 答案解析 | 提交后按权限加载，属于私有答案域。 |
| `rubric` | 评分量规 | 评分标准和细则，属于私有数据。 |
| `misconception_mapping` | 选项到误区的映射 | 用于错误诊断。 |
| `student_response` | 学生作答 | 后续 LearningEvent 的私有字段。 |
| `mistake` | 错题信息 | 后续学习事件字段。 |
| `mastery` | 掌握度 | 后续学习事件字段。 |
| `card_id` | 运行时卡片编号 | 只在当前回合生成，禁止写入检索索引。 |
| `assemble_cards` | 组装卡片动作 | 从素材和公开题面生成当前卡片。 |
| `hydrate_knowledge_objects` | 补全知识对象动作 | 根据检索引用加载权威对象。 |
| `search_knowledge` | 搜索知识动作 | 内部检索能力，不直接暴露给双工模型。 |
| `resolve_turn` | 解析回合动作 | 内部意图和槽位解析能力。 |

### 12.1 题目与学习对象

| 英文名称 | 中文含义 | 是否可进入通用检索 |
|---|---|---:|
| `AssessmentItem` | 通用题目对象 | 仅公开部分可以 |
| `AssessmentItemPublic` | 题目公开域 | 可以，保存题干、选项和公开属性 |
| `AssessmentKeyPrivate` | 题目私有答案域 | 不可以，只能按精确 ID 读取 |
| `LearningEvent` | 学习事件 | MVP 2.0 不在线启用 |
| `Assignment` | 作业任务 | 后续启用 |
| `Submission` | 学生提交 | 不进入共享知识域 |
| `Attempt` | 一次作答尝试 | 学生私有 |
| `Misconception` | 错误概念 / 误区 | 用于诊断 |
| `Mastery` | 掌握度 | 学生私有学习状态 |

## 13. Grounding、失败、降级和可观测性字段

### 13.1 `TeachingPackage` 的回答依据

| 字段或枚举 | 中文含义 | 系统行为 |
|---|---|---|
| `grounding` | 回答依据对象 | 描述本轮依据真实知识、状态、模型常识还是错误。 |
| `grounding.mode` | 回答依据模式 | `TeachingPackage` 中的模式字段。 |
| `retrieved` | 已召回依据 | 回答基于真实知识对象，可携带合法引用和卡片。 |
| `state_authoritative` | 服务端权威状态结果 | 用于判题或状态动作，知识召回为 0 次。 |
| `model_prior` | 模型既有知识 | 正常未命中时可回答普通知识，但不能伪造引用或正式题目。 |
| `clarify` | 澄清 | 缺少关键信息时先追问。 |
| `tool_error` | 工具错误 | 外部接口技术失败，不能伪装成正常未命中。 |
| `answer_brief` | 回答事实简报 | 从权威 Claim 整理出的核心事实。 |
| `answer_from_brief` | 按事实简报回答 | 指示双工模型围绕受控事实自然表达。 |
| `missing_topic` | 缺少主题 | `clarify` 的一种原因。 |
| `Surface` | 当前页面表面状态 | 出错时保留已有页面，不被错误结果覆盖。 |
| `Fail Closed` | 失败时默认拒绝 | 权限无法验证时不返回任何内容。 |

### 13.2 日志和回放字段

| 字段 | 中文含义 | 用途 |
|---|---|---|
| `resolved_route` | 最终路由 | 记录服务端最后选择的处理链路。 |
| `topic_source` | 主题来源 | 原话、近期上下文或系统状态。 |
| `retrieval_plan_id` | 召回计划编号 | 日志中关联 `plan_id` 的字段。 |
| `principal_context` | 权限上下文摘要 | 只记录校验结论，不记录原始 Token。 |
| `strategy_used` | 实际检索策略 | 例如关键词、向量、混合或混合加重排。 |
| `degraded_stage` | 降级阶段 | 记录具体在哪一步发生降级。 |
| `no_match_reason` | 未命中原因 | 正常空结果的内部分类。 |
| `provider_error_code` | Provider 错误码 | 记录技术故障类型。 |

## 14. 示例 ID 和 URI 的命名规律

| 示例 | 中文解释 |
|---|---|
| `turn_008` | 第 008 个回合的示例编号。 |
| `req_turn_008` | 第 008 回合对应的外部请求编号。 |
| `req_turn_009 / req_turn_010` | 第 009 / 010 回合的外部请求编号，命名规则相同。 |
| `plan_turn_008` | 第 008 回合的召回计划编号。 |
| `ret_008` | 第 008 次召回编号；`ret` 是 retrieval 的缩写。 |
| `ret_009 / ret_010` | 第 009 / 010 次召回编号，命名规则相同。 |
| `authctx_7f91` | 权限上下文编号；`authctx` 是 authorization context 的缩写。 |
| `pkg_turn_007` | 第 007 回合的教学结果包编号。 |
| `kb_20260725_03` | 知识库索引快照编号；`kb` 是 knowledge base。 |
| `course_physics_101` | 物理课程编号示例。 |
| `chapter_newton_laws` | 牛顿定律章节编号示例。 |
| `doc_physics_book_01` | 物理教材文档编号。 |
| `docrev_physics_book_01_v3` | 该文档第 3 个不可变 Revision。 |
| `rev_3` | 文档第 3 个 Revision 的简化编号示例。 |
| `chunk_docrev_v3_p42_03` | 第 3 版文档第 42 页附近的第 3 个 Chunk。 |
| `chunk_docrev_v3_p42_02 / chunk_docrev_v3_p43_01 / chunk_18` | 相邻 Chunk 和简化 Chunk 编号示例。 |
| `ku_newton2_force_ratio` | 牛顿第二定律比例关系知识单元；`ku` 是 knowledge unit。 |
| `claim_newton2_force_ratio` | 对应的事实声明编号。 |
| `entity_force / entity_mass / entity_acceleration` | 力、质量、加速度的标准实体编号示例。 |
| `ev_01` | 证据编号；`ev` 是 evidence。 |
| `quiz_newton_001` | 牛顿第二定律题目编号。 |
| `assessment-public://quiz_newton_001@3` | 题目第 3 版公开题面资源引用，不包含私有答案。 |
| `physics.newton.second_law` | Taxonomy 中的牛顿第二定律知识点编号。 |
| `quiz.single-choice` | 卡片 Registry 中的单选题卡类型。 |
| `edu_hybrid_v1` | 教育混合检索策略第 1 版的示例编号。 |
| `recent_topic_3turn_10min_v1` | “最近 3 回合或 10 分钟”上下文继承策略的示例编号。 |
| `sha256:...` | 使用 SHA-256 算法得到的内容摘要示例。 |

## 15. 检索、排序、质量与性能术语

| 英文词或缩写 | 中文含义 | 在本方案中的作用 |
|---|---|---|
| `Hybrid Retrieval` | 混合检索 | 同时使用关键词和向量语义检索。 |
| `Lexical` | 词法 / 关键词检索 | 擅长公式、专有名词、编号和精确词语。 |
| `BM25` | 经典关键词相关性算法 | 根据词频、文档频率和长度计算相关性。 |
| `Dense Vector` | 稠密语义向量 | 用向量距离寻找语义相近内容。 |
| `ANN` | 近似最近邻搜索 | 大规模向量 Top-K 检索方法。 |
| `Fusion` | 多路结果融合 | 合并关键词与向量两路排名。 |
| `RRF` | 倒数排名融合 | Reciprocal Rank Fusion，避免直接相加不同尺度的分数。 |
| `Rank Fusion` | 排名融合 | 按多个检索通道的排名生成综合顺序。 |
| `Rerank` | 二次重排 | 对少量候选用更精细模型重新排序。 |
| `Top-K` | 排名前 K 条 | 控制每个阶段保留的候选数量。 |
| `Query Rewrite` | 查询改写 | 根据上下文补全或规范化查询。 |
| `Filter` | 过滤条件 | 在候选生成前限制权限、类型、状态和知识点。 |
| `Metadata` | 元数据 | 描述内容来源、课程、章节、权限和时间等属性。 |
| `Taxonomy` | 分类体系 | 稳定的学科、章节和知识点树。 |
| `Hydrate` | 补全对象 | 根据 ID 从权威仓库读取完整对象。 |
| `Chunk` | 知识片段 | 文档切分后的可检索、可引用原文单元。 |
| `Citation` | 引用 | 回答所使用的来源证明。 |
| `Claim-Evidence` | 事实—证据关系 | 表示一条事实由哪些原文证据支撑。 |
| `Recall@5` | 前 5 条结果召回率 | 应找到的相关对象中，有多少进入前 5。 |
| `nDCG@10` | 前 10 条归一化折损累计增益 | 同时衡量相关结果是否找到以及排序是否合理。 |
| `MRR@5` | 前 5 条平均倒数排名 | 衡量第一个正确结果出现得是否足够靠前。 |
| `Macro-F1` | 各类别 F1 的宏平均 | 衡量各类路由识别效果，避免大类掩盖小类。 |
| `P95 / P99` | 第 95 / 99 百分位耗时 | 95% / 99% 请求不超过该耗时。 |
| `QPS` | 每秒请求数 | 检索服务吞吐量。 |
| `EOU` | 用户话语结束 | End Of Utterance，语音延迟的起始计时点。 |
| `ms` | 毫秒 | 千分之一秒。 |
| `s` | 秒 | 性能时间单位。 |
| `SLA` | 服务等级协议 | 外部供应商承诺的可用性和性能标准。 |
| `Spike` | 技术探测 | 在正式开发前验证接口能力、性能和风险。 |
| `Shadow` | 影子运行 | 新策略只记录结果，不影响用户，用于离线比较。 |

## 16. 安全、协议和工程缩写

| 缩写或技术词 | 中文全称 | 在本方案中的含义 |
|---|---|---|
| `MVP` | 最小可行产品 | 当前版本必须完成的最小交付范围。 |
| `PRD` | 产品需求文档 | 定义产品范围、协议和验收标准。 |
| `LLM` | 大语言模型 | 双工模型或未来可选的低置信度语义兜底模型。 |
| `AI` | 人工智能 | 本项目的模型与智能编排能力。 |
| `ASR` | 自动语音识别 | 把用户语音转换成 `raw_text`。 |
| `OCR` | 光学字符识别 | 从扫描教材或图片提取文本。 |
| `ACL` | 访问控制列表 | 决定当前用户能搜索和读取哪些内容。 |
| `CAS` | 比较并交换 / 比较并设置 | 提交状态前检查版本，避免并发覆盖。 |
| `API` | 应用程序接口 | 系统组件间的调用合同。 |
| `HTTP` | 超文本传输协议 | `HttpKnowledgeProvider` 与外部服务通信的协议。 |
| `TLS` | 传输层安全协议 | 加密应用服务与 Provider 之间的网络通信。 |
| `JSON` | JavaScript 对象表示法 | 接口和 Schema 的结构化数据格式。 |
| `JSON Schema` | JSON 结构校验规则 | 校验字段、类型、必填项和枚举。 |
| `Schema` | 数据结构规范 | 定义对象允许哪些字段和值。 |
| `DSL` | 领域专用语言 | 外部 Filter 的表达语法。 |
| `ID` | 唯一标识符 | 稳定区分对象、请求、回合或版本。 |
| `URI` | 统一资源标识符 | 例如公开题面引用地址。 |
| `MIME` | 多用途互联网邮件扩展类型 | 表示文件媒体格式。 |
| `ISBN` | 国际标准书号 | 标识教材图书。 |
| `NFKC` | Unicode 兼容规范化形式 | 统一全角、兼容字符等不同写法。 |
| `Unicode` | 统一字符编码标准 | 保证中文、公式和符号一致处理。 |
| `SHA-256` | 256 位安全哈希算法 | 生成 `content_hash` 和 `excerpt_hash`。 |
| `UI` | 用户界面 | 页面和卡片展示层。 |
| `A2UI` | Agent 到 UI | Agent 结果到确定性页面组件的协议。 |
| `HTML` | 超文本标记语言 | 卡片组装器不得执行模型生成的 HTML。 |
| `CSS` | 层叠样式表 | 卡片组装器不得执行模型生成的 CSS。 |
| `JavaScript / JS` | 页面脚本语言 | 卡片组装器不得执行模型生成的脚本。 |
| `API Key` | 接口密钥 | 外部服务鉴权凭证，禁止进入业务日志。 |
| `Token` | 授权令牌 / 文本令牌 | 在安全上下文表示凭证；在 `token_count` 中表示文本计量单位。 |
| `5xx` | HTTP 服务端错误码段 | 500—599，表示 Provider 或上游技术故障。 |

## 17. 尚未冻结具体枚举的字段

这些字段已经定义了含义，但合法值仍需在外部接口 Spike 或数据治理方案中冻结：

| 字段 | 需要后续确定的内容 |
|---|---|
| `visibility` | 公开、租户、学校、课程、班级、个人等层级。 |
| `sensitivity` | 普通、敏感、高敏等分级及对应处理规则。 |
| `release_policy` | 立即发布、定时发布、作答后公开等策略。 |
| `trust_tier` | 出版方、教师审核、机器生成等可信等级。 |
| `parse_status` | 待解析、解析中、完成、失败、需复核等状态。 |
| `verification_status` | 机器生成、教师审核、出版方审核等状态。 |
| `consent_status` | 录音授权、撤回和保留状态。 |
| `response_type` | 单选、多选、文本、口语等作答形式。 |
| `event_type` | 课堂、考试、作业提交、错题发生等事件类型。 |
| `action` | `SemanticHint` 中结构化动作对象的子字段。 |
| `surface_slots[]` | 每个表面槽位对象的最终字段结构。 |

## 18. 最容易混淆的词

| 容易混淆的词 | 区别 |
|---|---|
| `SemanticHint` 与 `hint` | 前者是模型给服务端的语义提示；后者是“给我一道题目提示”的教学动作。 |
| `route` 与 `decision` | `route` 描述业务类别；`decision` 描述本轮实际执行动作。二者通常一致，但语义职责不同。 |
| `surface_slots` 与 `slots` | 前者只保存原话表面词；后者是服务端归一化后的权威执行参数。 |
| `semantic_query` 与 `semantic_text` | 前者位于 `ResolvedIntent`；后者位于 `RetrievalPlan`，是发给检索器的最终语义文本。 |
| `query_text` 与 `raw_text` | `query_text` 是模型认为可用于查询的原话片段；`raw_text` 是完整用户原话。 |
| `must`、`prefer` 与 `must_not` | 分别表示必须满足、优先满足、必须排除。 |
| `assessment_item` 与 `quiz.single-choice` | 前者是知识对象类型；后者是页面卡片类型。 |
| `AssessmentItemPublic` 与 `AssessmentKeyPrivate` | 前者是可展示题面；后者是不可检索的答案和评分规则。 |
| `material_id` 与 `card_id` | 前者是可复用素材编号；后者是当前回合临时生成的卡片编号。 |
| `document_id` 与 `revision_id` | 前者跨版本稳定；后者固定某一次不可变内容版本。 |
| `event_time` 与 `published_at` | 前者是课堂、考试等事件实际发生时间；后者是内容发布时间。 |
| `event_time_range` 与 `event_start_at / event_end_at` | 前者是查询或状态中的范围；后者是知识对象自身的事件时间。 |
| `matched`、`no_match` 与 `error` | 分别表示正常命中、正常执行但为空、技术失败；三者不能互相冒充。 |
| `retrieved` 与 `model_prior` | 前者有真实召回依据；后者只使用模型常识，不能伪造引用或正式题目。 |
| `Provider` 与 `Repository` | Provider 负责搜索候选；Repository 按精确 ID 读取权威完整对象。 |
| `score` 与正确率 | `score` 是检索相关性分数，不是答案正确概率。 |
| `source_type` 与 `source` | `source_type` 是资料类型；`source` 是某个槽位或过滤条件的产生来源。 |

## 19. 学习工作台与知识本体新增字段

### 19.1 本体对象字段

| 英文字段 | 中文含义 | 实际作用 |
|---|---|---|
| `ontology_id` | 知识本体编号 | 标识“初中数学”这套稳定知识体系，不因小版本更新而变化。 |
| `ontology_version` | 本体版本 | 固定某一次知识点和关系集合，保证历史状态可回放。 |
| `entity_class` | 实体类别 | 区分课程领域、课程主题、可测知识点、定理、方法等对象。 |
| `domain_id` | 课程领域编号 | 指向数与代数、图形与几何等顶层领域。 |
| `theme_id` | 课程主题编号 | 指向知识地图中的主题分组。 |
| `knowledge_point_id` | 知识点编号 | 题目、掌握状态、计划和事件共同使用的稳定关联键。 |
| `measurable_skill` | 可测知识点 | 能通过题目或学习行为形成相对明确证据的能力单元。 |
| `measurable_behavior` | 可测行为 | 说明学生具体要能理解、判断、计算、证明或应用什么。 |
| `knowledge_form` | 知识形态 | 区分概念、程序、定理、方法等学习形态。 |
| `learning_stage` | 学习学段 | 当前对象适用的课程阶段，例如第四学段。 |
| `optional` | 是否选学 | 标记课标中的选学内容。 |
| `source_ref` | 来源引用 | 指向课程标准或教材中的直接依据。 |
| `printed_page` | 印刷页码 | 页面详情中展示的纸质资料页码，不等同于 PDF 页序。 |
| `extraction_source` | 抽取来源 | 记录本体是从哪份整理材料或流程生成的。 |
| `visualization` | 可视化配置 | 保存图谱分组、顺序和标签优先级。 |
| `cluster_id` | 图谱簇编号 | 告诉图形系统该知识点应放在哪个主题簇。 |
| `label_priority` | 标签优先级 | 图谱空间不足时决定哪些知识点名称优先显示。 |
| `review_status` | 审核状态 | 表示实体或关系是否已经人工审核。 |
| `aliases` | 别名列表 | 支持教材不同叫法和中文搜索召回。 |

### 19.2 关系字段

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `edge` | 关系边 | 连接两个知识实体的一条关系记录。 |
| `source` | 起点 | 关系边从哪个实体开始；这里不是“资料来源”。 |
| `target` | 终点 | 关系边指向哪个实体。 |
| `type` | 关系类型 | 决定这条边是先修、隶属、强关联还是联合应用。 |
| `directed` | 是否有方向 | `true` 表示起点和终点不能交换。 |
| `rationale` | 建边理由 | 解释为什么建立这条关系，便于审核。 |
| `part_of` | 隶属于 | 知识点属于主题，主题属于领域。 |
| `prerequisite_of` | 是……的先修 | 起点能力会实质影响终点能力的学习或作答。 |
| `strongly_related_to` | 强关联 | 两个知识点适合联合教学、检索或形成综合题。 |
| `applied_with` | 联合应用 | 两个知识点经常在同一解题链中共同使用。 |
| `equivalent_view_of` | 等价视角 | 同一数学对象在不同表示或领域中的视角。 |
| `represented_by` | 由……表示 | 一个知识通过图象、数轴、式子等方式表征。 |
| `supported_by` | 由……支撑 | 结论或方法由另一项基础能力支撑。 |

### 19.3 学生掌握状态字段

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `student_id` | 学生编号 | 标识掌握状态属于哪位学生，不能由模型或浏览器猜测。 |
| `state_version` | 状态版本 | 防止并发写入覆盖更新，也支持回放。 |
| `records` | 掌握记录列表 | 保存该学生在每个知识点上的当前投影。 |
| `mastery_state` | 掌握档位 | 五档中文状态的机器值。 |
| `mastery_probability` | 掌握概率 | 状态服务基于有效事件估计的概率，不是单题正确率。 |
| `confidence` | 状态可信度 | 当前掌握结论有多可靠，受证据数量、质量和新鲜度影响。 |
| `evidence_count` | 有效证据数 | 真正通过门禁并参与状态计算的学习证据数量。 |
| `last_event_at` | 最近证据时间 | 最近一次有效学习事件发生时间。 |
| `latest_source` | 最近证据来源 | 最近证据来自课堂、题库、作业或试卷等渠道。 |
| `mastered` | 熟练掌握 | 多次、跨情境、低提示成功。 |
| `secure` | 基本掌握 | 近期表现稳定，但迁移性仍需验证。 |
| `learning` | 学习中 | 有进展但表现波动或仍依赖提示。 |
| `weak` | 待加强 | 多次错误或关键步骤持续缺失。 |
| `unassessed` | 未评估 | 缺少有效证据；不是“不会”。 |

### 19.4 学生偏好与材料导入字段

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `direct_assessment_preferences` | 直接考查偏好列表 | 保存“暂时不要直接考这个点”等学生偏好。 |
| `preference` | 偏好类型 | 指定要调整哪类出题行为。 |
| `suppress_direct_questions` | 减少直接出题 | 暂时减少以该点为主知识点的重复题。 |
| `student_self_report` | 学生自我陈述 | 表明数据来自学生说法，不是测评结论。 |
| `mastery_changed` | 是否改变掌握度 | 对自述偏好必须为 `false`。 |
| `expires_at` | 到期时间 | 偏好何时失效，避免永久屏蔽知识点。 |
| `import_batches` | 导入批次列表 | 按一次作业或试卷导入组织事件，便于审核与撤销。 |
| `batch_id` | 批次编号 | 唯一定位一次材料导入。 |
| `accepted_evidence_count` | 已采用证据数 | 通过门禁并可参与状态计算的证据数量。 |
| `review_required_count` | 待复核数 | 低置信或冲突、暂时不能写入状态的记录数。 |
| `rollback` | 撤销批次 | 使该批次事件失效并从剩余有效事件重新计算状态。 |

### 19.5 页面与图谱常用词

| 英文词 | 中文解释 | 在页面中的含义 |
|---|---|---|
| `Knowledge Graph` | 知识图谱 | 展示知识点、关系和学生掌握投影的可交互地图。 |
| `Ontology` | 本体 | 规定有哪些知识实体、实体含义和合法关系的结构化模型。 |
| `Mastery` | 掌握程度 | 某位学生针对具体知识点的动态学习状态。 |
| `Learner Profile` | 学习者画像 | 相对稳定的学习偏好和跨主题特征，不等于掌握状态。 |
| `Learning Event` | 学习事件 | 一次作答、提示、导入、课堂互动或自述等可审计事实。 |
| `Question History` | 历史题目 | 学生过去实际做过的题和作答记录。 |
| `Study Companion` | 学习搭子 | 负责陪伴、节奏和习惯，不承担教学权威。 |
| `Coverage` | 覆盖面积 | 某掌握档位占整套知识点的比例。 |
| `Local Relations` | 局部关系 | 只展开当前选中知识点的直接相邻关系。 |
| `Reduced Motion` | 减少动态效果 | 无障碍设置开启后跳过抽书和翻页等待。 |

## 20. Agent 学习闭环、题库、用户与课程字段

### 20.1 Agent 提案与回执

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `proposal` | 提案 | Agent 的建议，尚不是系统事实。 |
| `receipt` | 回执 | 系统校验和水合后返回的最终处理结果。 |
| `schema_version` | 协议版本 | 区分不同数据合同，防止新旧字段混用。 |
| `request_id` | 本轮请求编号 | 由服务端生成，Agent 只能原样返回，用于防串线。 |
| `answer` | 可展示回答 | 学生实际看到的文字。 |
| `ui_plan` | 界面展示计划 | 完整包含旧版 `ai-teacher-ui@1.1`，用于固定卡片。 |
| `event` | 事件分类提案 | 表示这一轮可能是讲解、出题、作答或自述。 |
| `knowledge_proposals` | 知识点提案列表 | 记录 Agent 对本轮所属知识点的候选选择。 |
| `mastery_evidence_proposals` | 掌握证据提案列表 | 只描述可能的证据，不能携带掌握度结果。 |
| `assessment_proposals` | 题目提案列表 | 包含动态题的题目画像、公开题面和私有判题数据。 |
| `visual_proposals` | 互动图提案列表 | 只包含受控数据规格，不包含可执行代码。 |
| `candidate_id` | 本轮临时候选编号 | 系统预召回后生成；Agent 只能从本轮列表中选择。 |
| `mention` | 原始提及 | 保留 Agent 理解到的用户说法，便于审核映射。 |
| `role` | 知识点角色 | 区分主知识点、辅助点、前置点或关联点。 |
| `evidence_spans` | 证据文本片段 | 保留该提案依据用户的哪句话或哪个工具结果。 |
| `mapped` | 已映射 | 所有主要提案都找到唯一有效知识点。 |
| `partial_mapping` | 部分映射 | 只有一部分提案完成知识点对齐。 |
| `no_match` | 未匹配 | 没有可靠知识点；不生成掌握证据。 |
| `conflict` | 映射冲突 | 候选多义、过期或指向不存在的本体对象。 |
| `hydrate` | 水合 | 把 Agent 提案中的临时引用换成系统真实对象，并应用安全规则。 |
| `event_decision` | 事件处理决定 | 记录系统接受了哪个事件类型，或是否覆盖 Agent 分类。 |
| `evidence_decisions` | 证据处理决定 | 记录每条证据是接受、待审、拒绝还是仅作偏好。 |
| `diagnostics` | 诊断信息 | 记录部分映射、降级或被拒绝的原因码。 |

### 20.2 掌握证据与一致性

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `evidence_mode` | 证据模式 | 区分直接测评、间接推断和学生自述。 |
| `direct_assessment` | 直接测评 | 必须引用服务端真实作答证据。 |
| `inferred` | 间接推断 | 如使用提示、重复犯错，默认不直接改掌握度。 |
| `self_report` | 学生自述 | 如“很简单”或“我不会”，只作偏好或辅助信息。 |
| `signal_type` | 学习信号类型 | 表示正确、错误、部分得分、提示使用等具体信号。 |
| `evidence_ref` | 证据引用编号 | 指向服务端已存在的作答、步骤或教师确认记录。 |
| `apply_to_mastery` | 是否参与掌握计算 | 只能由系统设置；Agent 不能填写。 |
| `preference_only` | 仅存为偏好 | 不参与掌握度计算。 |
| `idempotency_key` | 幂等键 | 防止重试时重复写入学习事件。 |
| `expected_state_version` | 预期状态版本 | 进行 CAS 冲突检测，防止并发更新互相覆盖。 |
| `CAS` | 比较并交换 | 只在数据版本与预期一致时更新。 |

### 20.3 题目与互动图

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `blueprint` | 出题蓝图 | 定义题型、认知层级、难度、命题方式和预计时间。 |
| `public_item` | 公开题面 | 可下发给学生的题干、指令和选项。 |
| `private_key` | 私有判题密钥 | 正确答案、解析、解题路径和评分点，只存服务端。 |
| `question_type` | 题型 | 如单选、填空、简答和解答题。 |
| `proposition_method` | 命题方式 | 如直接考查、条件变式、情境建模、图表信息。 |
| `ability_level` | 能力层级 | 说明题目要求理解、应用、推理或模型建构。 |
| `core_abilities` | 核心能力列表 | 如抽象能力、运算能力、推理能力、模型观念。 |
| `context` | 题目情境 | 如纯数学、生活、几何图形或数据情境。 |
| `solution_plan` | 解题思路计划 | 包含步骤、关键转折、常见错误、其他解法和解释。 |
| `key_turning_point` | 关键转折 | 从题目条件过渡到解法的关键判断。 |
| `common_errors` | 常见错误 | 保存错误现象、原因和建议反馈。 |
| `alternative_solutions` | 其他解法 | 用于一题多解和方法对比。 |
| `scoring_points` | 评分点 | 用于解答题分步判定和部分得分。 |
| `publishable` | 是否可发布 | `false` 表示题目只是草稿，未通过发布门禁。 |
| `pending_teacher_review` | 待教师审核 | 内容或答案尚未获得教研确认。 |
| `assessment_proposal_id` | 题目提案编号 | 让互动图与当前动态题同源绑定。 |
| `visual_spec` | 互动图数据规格 | 只允许受控参数，不允许代码、HTML 或 URL。 |
| `visibility` | 可见时机 | 区分立即展示、作答后展示和仅教师可见。 |
| `after_submit` | 作答后展示 | 用于解题图，避免提前泄露答案。 |

### 20.4 用户与课程

| 英文字段或取值 | 中文含义 | 实际作用 |
|---|---|---|
| `tenant_id` | 租户编号 | 区分学校、机构或组织的数据范围。 |
| `user_id` | 用户编号 | 隔离会话、掌握度、错题、计划和课程进度。 |
| `session_id` | 会话编号 | 区分同一用户的多次学习对话。 |
| `turn_id` | 回合编号 | 定位一问一答及其产生的卡片和证据。 |
| `simulated` | 是否模拟用户 | 标明当前身份用于原型验证，不是真实鉴权账号。 |
| `course_id` | 课程编号 | 稳定标识一门课程。 |
| `course_progress` | 课程进度 | 保存用户已完成章节、当前章节和学习时长。 |
| `chapter_id` | 章节编号 | 定位课程中的某一学习单元。 |
| `current_chapter_id` | 当前章节编号 | 记录用户下次继续学习的位置。 |
| `completed_chapter_ids` | 已完成章节列表 | 计算课程完成度。 |
| `reference` | 课程受控关联 | 指向课标、知识图谱、题库范围、计划或口语场景。 |
