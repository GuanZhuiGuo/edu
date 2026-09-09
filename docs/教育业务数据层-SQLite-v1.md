# 教育业务数据层 SQLite v1

## 定位

该数据层存储产品运行时的结构化业务数据：学生、本体、本体实体/关系、知识点、题目、私有答案、掌握证据、掌握投影和学习事件。Qdrant 与 Neo4j 仍承担知识发布后的向量召回和图扩展；SQLite 是学生个人数据与业务事实的权威库。

默认数据库：`data/education-runtime/education.sqlite`，已被 Git 忽略。可通过 `EDUCATION_DATA_DB_PATH` 修改。

## 数据边界

- 运行时 API 从 SQLite 查询，不再从前端 JavaScript 常量读取业务事实。
- 当前首次种子来自仓库中已编译的课标本体、题库和演示学情。它们会真实写入数据库，但个人数据全部标记 `is_demo=true` / `demo_seed=true`，不得冒充真实学生测量。
- 完整答案与解题思路位于 `education_question_solutions`，普通题目列表/详情不做 JOIN，仅服务端身份 `can_reveal_solutions=true` 时可读。
- Agent 只能提交掌握证据，不能写掌握概率。`apply_to_mastery=true` 还必须通过服务层注入的 `verifyMasteryEvidence`（核对作答、判题和学生归属）；`mastery_probability` 和 `mastery_state` 再由确定性投影器计算。
- 每个个人数据查询同时约束 `tenant_id + student_id`；浏览器请求中的 `tenant_id` 被忽略。

## 初始化

```bash
npm run init:data
```

初始化是幂等的：执行 SQL migration，再以内容指纹导入种子。已存在且修订不同的同版本本体/题库会返回 409，不会静默覆盖。

## HTTP 协议

| 方法 | 路由 | 返回 |
|---|---|---|
| GET | `/api/education/data/summary` | 存储类型和各表真实行数 |
| GET | `/api/education/students` | 当前会话可见的学生及掌握概要 |
| GET | `/api/education/students/:id` | 学生档案、掌握概要、最近事件 |
| GET | `/api/education/students/:id/mastery` | 按本体返回140个知识点投影，可用 `state` 筛选 |
| GET | `/api/education/students/:id/learning-events` | 可审计学习事件 |
| POST | `/api/education/students/:id/mastery-evidence` | 幂等写入证据并返回新投影，需 `can_write_mastery` |
| GET | `/api/education/ontologies` | 本体版本列表 |
| GET | `/api/education/ontologies/:id/graph` | 本体类、关系类型、实体与边；`include_questions=true` 增加题目节点 |
| GET | `/api/education/knowledge-points` | 知识点分页/搜索 |
| GET | `/api/education/questions` | 题型、难度、出题方式、知识点筛选 |
| GET | `/api/education/questions/:id` | 公开题目详情，不含答案 |
| GET | `/api/education/questions/:id/solution` | 私有答案/解题思路，需 `can_reveal_solutions` |

成功列表统一返回 `items`，分页返回 `total / limit / offset`。错误统一为：

```json
{
  "error": "stable_error_code",
  "message": "可向用户展示的中文说明"
}
```

## server.js 接线

```js
import { createEducationDataRuntime } from "./education-data-runtime.js";
import { createEducationDataService } from "./education-data-service.js";
import { createEducationDataHttpHandler } from "./education-data-http.js";

const educationDataRuntime = createEducationDataRuntime({ env: process.env });
const educationDataService = createEducationDataService({ store: educationDataRuntime.store });
const handleEducationDataHttp = createEducationDataHttpHandler({
  service: educationDataService,
  authorizeRequest: isLoopbackRequest,
  resolveIdentity: () => ({
    tenant_id: educationDataRuntime.tenantId,
    can_read_all_students: true,
    can_write_mastery: false,
    can_reveal_solutions: false
  })
});
```

上面的本地浏览器身份故意禁止通用掌握写入。正式判题链路需向 `createEducationDataService`
注入 `verifyMasteryEvidence(input)`，只有能在服务端找到同租户、同学生、同题目作答且判题结果一致时才返回 `true`。

在静态文件处理之前调用 `await handleEducationDataHttp(req, res, requestUrl)`，服务停止时调用 `educationDataRuntime.store.close()`。生产环境必须用真实登录会话替代本地 loopback 身份。
