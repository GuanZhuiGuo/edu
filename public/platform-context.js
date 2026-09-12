/*
 * The platform shell is shared by education and enterprise learning. A profile
 * supplies terminology, seed content and visibility rules; capabilities remain
 * stable so workspaces, assessment and asset contracts do not fork.
 */
export const PLATFORM_CONTEXT = Object.freeze({
  activeProfile: "education",
  profiles: Object.freeze({
    education: Object.freeze({
      labels: Object.freeze({ learner: "学生", instructor: "教师", group: "班级", course: "课程", asset: "课件", competency: "知识点" }),
      contentDomains: ["语文", "数学", "物理", "化学", "地理", "生物"],
      capabilities: ["classroom", "courseware", "question-bank", "assessment", "knowledge", "community"]
    }),
    enterprise_training: Object.freeze({
      labels: Object.freeze({ learner: "学员", instructor: "讲师", group: "团队", course: "学习项目", asset: "培训资产", competency: "能力项" }),
      contentDomains: ["产品", "销售", "研发", "客户服务", "合规", "管理"],
      capabilities: ["learning-room", "courseware", "question-bank", "assessment", "knowledge", "community"]
    })
  }),
  navigation: Object.freeze([
    { id: "agent", capability: "classroom", route: "agent" },
    { id: "courseware-assistant", capability: "courseware", route: "courseware-assistant" },
    { id: "courseware-library", capability: "courseware", route: "courseware-library" },
    { id: "bank", capability: "question-bank", route: "bank" },
    { id: "assessment", capability: "assessment", route: "assessment" },
    { id: "graph", capability: "knowledge", route: "graph" },
    { id: "buddy", capability: "community", route: "buddy" }
  ])
});

export function getPlatformProfile(profile = PLATFORM_CONTEXT.activeProfile) {
  return PLATFORM_CONTEXT.profiles[profile] || PLATFORM_CONTEXT.profiles.education;
}
