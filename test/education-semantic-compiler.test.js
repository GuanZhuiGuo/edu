import assert from "node:assert/strict";
import test from "node:test";

import { compileEducationImportCandidates } from "../education-import-compiler.js";
import {
  EDUCATION_SEMANTIC_COMPILER_INSTRUCTIONS,
  compileEducationSemanticProposals,
  mergeSemanticProposalsIntoCandidatePack,
} from "../education-semantic-compiler.js";
import {
  EDUCATION_IMPORT_SCHEMA_VERSION,
  assertDocumentIR,
  assertQuestionKnowledgeLink,
  assertTypedRelation,
} from "../education-import-contracts.js";

const RECORDED_AT = "2026-08-17T03:00:00.000Z";
const FILE_HASH = "d".repeat(64);

function block(id, type, text, readingOrder) {
  return {
    id,
    type,
    page_index: 0,
    reading_order: readingOrder,
    text,
    layer: "printed",
    extraction: { method: "native_pdf", confidence: 0.96 },
  };
}

function fixtureDocument() {
  const document = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: "document_semantic_exam",
    revision_id: "document_semantic_exam:r1",
    document_type: "exam_paper",
    title: "一次函数诊断题",
    language: "zh-CN",
    subject: "math",
    grade_band: "junior_secondary",
    source_file: {
      file_name: "linear-function.pdf",
      mime_type: "application/pdf",
      sha256: FILE_HASH,
      size_bytes: 2048,
    },
    pages: [{
      index: 0,
      printed_page: "1",
      width: 595,
      height: 842,
      unit: "pdf_points",
      blocks: [
        block("question_linear_1", "question_stem", "若 y=2x+1，当 x=3 时，求 y 的值。", 0),
        block("solution_linear_1", "solution", "把 x=3 代入 y=2x+1，得到 y=7。", 1),
      ],
    }],
    provenance: {
      method: "parsed_block",
      pipeline: { name: "semantic_fixture", version: "1.0" },
      source_anchors: [{
        document_id: "document_semantic_exam",
        document_revision_id: "document_semantic_exam:r1",
        page_index: 0,
        block_ids: ["question_linear_1"],
        quote: "若 y=2x+1，当 x=3 时，求 y 的值。",
        content_hash: FILE_HASH,
      }],
      parent_ids: [],
      recorded_at: RECORDED_AT,
    },
    confidence: { overall: 0.96, extraction: 0.96, source_alignment: 1 },
    review_status: "candidate",
  };
  return assertDocumentIR(document);
}

function fixtureCurriculumDocument() {
  const document = structuredClone(fixtureDocument());
  document.id = "document_semantic_curriculum";
  document.revision_id = "document_semantic_curriculum:r1";
  document.document_type = "curriculum_standard";
  document.title = "一次函数课程标准摘录";
  document.source_file.file_name = "linear-function-standard.pdf";
  document.pages[0].blocks = [
    block(
      "standard_linear_definition",
      "paragraph",
      "结合具体情境体会一次函数的意义，能根据已知条件确定一次函数的表达式。",
      0,
    ),
    block(
      "standard_linear_representation",
      "paragraph",
      "会画一次函数的图像，根据图像和表达式探索并理解一次函数的性质。",
      1,
    ),
  ];
  document.provenance.source_anchors = [{
    document_id: document.id,
    document_revision_id: document.revision_id,
    page_index: 0,
    block_ids: ["standard_linear_definition"],
    quote: document.pages[0].blocks[0].text,
    content_hash: FILE_HASH,
  }];
  return assertDocumentIR(document);
}

function fixturePack(document) {
  const deterministic = compileEducationImportCandidates(document);
  return {
    schema_version: "1.0",
    job_id: "import_education_semantic",
    document_id: document.id,
    document_revision_id: document.revision_id,
    generated_at: RECORDED_AT,
    updated_at: RECORDED_AT,
    processing_status: "completed",
    review_status: "needs_review",
    assets: [],
    candidates: {
      curriculum_standards: [],
      questions: deterministic.questions,
      submissions: [],
      typed_relations: [],
      question_knowledge_links: [],
      evidence: [],
    },
    rejected_candidates: [],
    warnings: [],
    receipt: {
      native: { pdf_tools_used: [], page_count: 1, native_text_characters: 52 },
      model: { used: false, models: [], request_ids: [], usage: null },
    },
    review_history: [],
  };
}

function fixturePackWithStandardClause(document) {
  const pack = fixturePack(document);
  pack.candidates.curriculum_standards = [{
    id: "standard_clause:linear_function",
    candidate_type: "standard_clause",
    canonical_name: "一次函数的意义与表示",
    source_anchor: {
      page_index: 0,
      block_ids: ["standard_linear_definition", "standard_linear_representation"],
    },
  }];
  return pack;
}

function fixtureTwoPageDocument() {
  const document = structuredClone(fixtureDocument());
  document.pages.push({
    index: 1,
    printed_page: "2",
    width: 595,
    height: 842,
    unit: "pdf_points",
    blocks: [
      {
        ...block("question_linear_2", "question_stem", "若 y=-x+4，当 x=2 时，求 y 的值。", 0),
        page_index: 1,
      },
      {
        ...block("solution_linear_2", "solution", "把 x=2 代入 y=-x+4，得到 y=2。", 1),
        page_index: 1,
      },
    ],
  });
  return assertDocumentIR(document);
}

function sourceRefs(...blockIds) {
  return [{ page_index: 0, block_ids: blockIds }];
}

function emptyOutput(overrides = {}) {
  return {
    entities: [],
    relations: [],
    question_links: [],
    solution_strategies: [],
    proposition_angles: [],
    misconceptions: [],
    ...overrides,
  };
}

function knowledgeCompetencyOutput({
  knowledgeBlockIds = ["standard_linear_definition"],
  competencyBlockIds = ["standard_linear_definition"],
  relations = [],
} = {}) {
  return emptyOutput({
    entities: [
      {
        proposal_id: "kp:linear_function_representation",
        entity_type: "knowledge_point",
        display_name: "一次函数的表示",
        statement: "联系一次函数的表达式、图像与具体情境。",
        action_verb: "表示",
        knowledge_form: "representation",
        aliases: [],
        parent_proposal_id: null,
        basis: "explicit",
        confidence: 0.92,
        source_refs: [{ page_index: 0, block_ids: knowledgeBlockIds }],
      },
      {
        proposal_id: "competency:mathematical_abstraction",
        entity_type: "competency",
        display_name: "数学抽象",
        statement: "从具体数量关系中抽象出一次函数模型。",
        action_verb: "抽象",
        knowledge_form: "reasoning_practice",
        aliases: [],
        parent_proposal_id: null,
        basis: "inferred",
        confidence: 0.86,
        source_refs: [{ page_index: 0, block_ids: competencyBlockIds }],
      },
    ],
    relations,
  });
}

test("compiles source-bound local knowledge proposals, relations, and exact question mappings", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  const question = pack.candidates.questions[0];
  let modelRequest;
  const modelClient = {
    async extractStructured(request) {
      modelRequest = request;
      return {
        model: "text-fixture-model",
        requestId: "semantic-request-1",
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
        data: emptyOutput({
          entities: [
            {
              proposal_id: "kp:linear_function_expression",
              entity_type: "knowledge_point",
              display_name: "一次函数表达式",
              statement: "理解一次函数表达式中自变量与函数值的对应关系。",
              action_verb: "理解",
              knowledge_form: "concept",
              aliases: ["一次函数关系式"],
              parent_proposal_id: null,
              basis: "inferred",
              confidence: 0.91,
              source_refs: sourceRefs("question_linear_1"),
            },
            {
              proposal_id: "kp:substitution_evaluation",
              entity_type: "knowledge_point",
              display_name: "代入求函数值",
              statement: "将给定自变量代入函数表达式并完成计算。",
              action_verb: "计算",
              knowledge_form: "procedure",
              aliases: [],
              parent_proposal_id: "kp:linear_function_expression",
              basis: "explicit",
              confidence: 0.94,
              source_refs: sourceRefs("question_linear_1", "solution_linear_1"),
            },
            {
              proposal_id: "dimension:operation_accuracy",
              entity_type: "assessment_dimension",
              display_name: "运算准确性",
              statement: "观察代入与数值计算是否准确。",
              action_verb: null,
              knowledge_form: "reasoning_practice",
              aliases: [],
              parent_proposal_id: null,
              basis: "inferred",
              confidence: 0.72,
              source_refs: sourceRefs("solution_linear_1"),
            },
          ],
          relations: [{
            proposal_id: "relation:expression_before_substitution",
            source_ref: "kp:linear_function_expression",
            target_ref: "kp:substitution_evaluation",
            relation_type: "prerequisite_of",
            scope: "same_framework",
            basis: "inferred",
            confidence: 0.84,
            source_refs: sourceRefs("question_linear_1", "solution_linear_1"),
          }],
          question_links: [{
            proposal_id: "question_link:linear_1_primary",
            question_id: question.id,
            question_revision_id: question.revision_id,
            part_id: question.parts[0].id,
            knowledge_proposal_id: "kp:substitution_evaluation",
            relation: "assesses",
            role: "primary",
            weight: 1,
            observable_indicator: "能够正确代入 x=3 并求出函数值",
            confidence: 0.92,
            source_refs: sourceRefs("question_linear_1", "solution_linear_1"),
          }],
          solution_strategies: [{
            proposal_id: "strategy:direct_substitution",
            name: "直接代入",
            description: "把已知自变量代入函数表达式后按运算顺序计算。",
            steps: ["确定自变量的值", "代入表达式", "完成计算并检查"],
            question_ids: [question.id],
            knowledge_proposal_ids: ["kp:substitution_evaluation"],
            basis: "explicit",
            confidence: 0.9,
            source_refs: sourceRefs("solution_linear_1"),
          }],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, candidatePack: pack, modelClient });

  assert.equal(modelRequest.strict, true);
  assert.equal(modelRequest.temperature, 0);
  assert.equal(modelRequest.maxOutputTokens, 32_768);
  assert.ok(modelRequest.schema.properties.question_links.items.properties.question_id);
  assert.ok(modelRequest.schema.properties.solution_strategies.items.properties.steps);
  assert.match("question_link:primary", new RegExp(modelRequest.schema.properties.question_links.items.properties.proposal_id.pattern, "u"));
  assert.match("relation:dependency", new RegExp(modelRequest.schema.properties.relations.items.properties.proposal_id.pattern, "u"));
  assert.match("strategy:direct", new RegExp(modelRequest.schema.properties.solution_strategies.items.properties.proposal_id.pattern, "u"));
  assert.doesNotMatch("entity:strategy:direct", new RegExp(modelRequest.schema.properties.solution_strategies.items.properties.proposal_id.pattern, "u"));
  assert.match(modelRequest.instructions, /Never invent a canonical ontology identifier/);
  assert.match(modelRequest.input, /question_linear_1/);
  assert.equal(modelRequest.input.includes("ARK_API_KEY"), false);
  assert.equal(result.candidates.curriculum_standards.length, 2);
  assert.equal(result.candidates.typed_relations.length, 1);
  assert.equal(result.candidates.question_knowledge_links.length, 1);
  assert.equal(result.extensions.assessment_dimensions.length, 1);
  assert.equal(result.extensions.solution_strategies.length, 1);
  assert.equal(result.proposal_id_map["kp:substitution_evaluation"].startsWith("semkp_"), true);

  const relation = result.candidates.typed_relations[0];
  assertTypedRelation(relation);
  assert.equal(relation.relation_type, "prerequisite_of");
  assert.equal(relation.review_status, "needs_review");
  assert.deepEqual(relation.provenance.source_anchors[0].block_ids, ["question_linear_1", "solution_linear_1"]);

  const link = result.candidates.question_knowledge_links[0];
  assertQuestionKnowledgeLink(link);
  assert.equal(link.question_id, question.id);
  assert.equal(link.knowledge_point_id, result.proposal_id_map["kp:substitution_evaluation"]);
  assert.equal(link.mapping_method, "model");
  assert.equal(link.review_status, "needs_review");
});

test("uses a compact strict schema for batches without questions while preserving anchored entities and relations", async () => {
  const document = fixtureCurriculumDocument();
  const pack = fixturePackWithStandardClause(document);
  let request;
  const modelClient = {
    async extractStructured(value) {
      request = value;
      return {
        model: "curriculum-fixture-model",
        requestId: "curriculum-request-1",
        data: emptyOutput({
          entities: [
            {
              proposal_id: "kp:linear_function_meaning",
              entity_type: "knowledge_point",
              display_name: "一次函数的意义",
              statement: "结合具体情境理解一次函数所表达的数量关系。",
              action_verb: "理解",
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.93,
              source_refs: sourceRefs("standard_linear_definition"),
            },
            {
              proposal_id: "kp:linear_function_representation",
              entity_type: "knowledge_point",
              display_name: "一次函数的图像表示",
              statement: "画出一次函数图像并联系表达式理解其性质。",
              action_verb: "表示",
              knowledge_form: "representation",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.92,
              source_refs: sourceRefs("standard_linear_representation"),
            },
          ],
          relations: [{
            proposal_id: "relation:meaning_before_representation",
            source_ref: "kp:linear_function_meaning",
            target_ref: "kp:linear_function_representation",
            relation_type: "builds_on",
            scope: "same_framework",
            basis: "inferred",
            confidence: 0.82,
            source_refs: sourceRefs("standard_linear_definition", "standard_linear_representation"),
          }],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({
    documentIR: document,
    candidatePack: pack,
    modelClient,
    limits: { maxOutputTokens: 4_096 },
  });

  assert.equal(request.maxOutputTokens, 4_096);
  assert.match(request.instructions, /This batch supplies no questions/u);
  assert.match(request.instructions, /every supplied explicit standard_clause or learning_objective/u);
  assert.deepEqual(request.schema.required, [
    "entities",
    "relations",
    "question_links",
    "solution_strategies",
    "proposition_angles",
    "misconceptions",
  ]);
  assert.ok(request.schema.properties.entities.items.properties.source_refs);
  assert.equal(request.schema.properties.entities.minItems, 1);
  assert.ok(request.schema.properties.relations.items.properties.source_refs);
  for (const key of [
    "question_links",
    "solution_strategies",
    "proposition_angles",
    "misconceptions",
  ]) {
    const property = request.schema.properties[key];
    assert.equal(property.maxItems, 0, `${key} must be fixed to an empty array`);
    assert.deepEqual(property.items.properties, {}, `${key} must not carry its full item schema`);
  }
  assert.equal(result.input_receipt.supplied_questions, 0);
  assert.equal(result.candidates.curriculum_standards.length, 2);
  assert.equal(result.candidates.typed_relations.length, 1);
  assert.deepEqual(result.extensions.solution_strategies, []);
});

test("requires an anchored entity proposal when an explicit standard clause is supplied", async () => {
  const document = fixtureCurriculumDocument();
  const pack = fixturePackWithStandardClause(document);
  let request;
  const modelClient = {
    async extractStructured(value) {
      request = value;
      return { data: emptyOutput() };
    },
  };

  await assert.rejects(
    compileEducationSemanticProposals({ documentIR: document, candidatePack: pack, modelClient }),
    (error) => error.code === "education_semantic_model_output_invalid"
      && /entities must contain at least one anchored proposal/u.test(error.message),
  );
  assert.equal(request.schema.properties.entities.minItems, 1);
});

test("allows an empty entity result when a no-question batch has no explicit standard records", async () => {
  const document = fixtureCurriculumDocument();
  let request;
  const modelClient = {
    async extractStructured(value) {
      request = value;
      return { data: emptyOutput() };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, modelClient });

  assert.equal(Object.hasOwn(request.schema.properties.entities, "minItems"), false);
  assert.equal(request.instructions.includes("every supplied explicit standard_clause"), false);
  assert.deepEqual(result.candidates.curriculum_standards, []);
});

test("supplements a stable reviewed develops_competency edge for an exact shared source anchor", async () => {
  const document = fixtureCurriculumDocument();
  const requests = [];
  const modelClient = {
    async extractStructured(request) {
      requests.push(request);
      return { data: knowledgeCompetencyOutput() };
    },
  };

  const first = await compileEducationSemanticProposals({ documentIR: document, modelClient });
  const second = await compileEducationSemanticProposals({ documentIR: document, modelClient });

  assert.match(requests[0].instructions, /same source anchor.*develops_competency/u);
  assert.equal(first.candidates.typed_relations.length, 1);
  const relation = first.candidates.typed_relations[0];
  assertTypedRelation(relation);
  assert.equal(relation.relation_type, "develops_competency");
  assert.equal(relation.source_type, "knowledge_point");
  assert.equal(relation.target_type, "competency");
  assert.equal(relation.review_status, "needs_review");
  assert.equal(relation.confidence.overall, 0.82);
  assert.deepEqual(relation.provenance.source_anchors[0].block_ids, ["standard_linear_definition"]);
  assert.equal(second.candidates.typed_relations[0].id, relation.id);
});

test("does not supplement develops_competency across different source anchors", async () => {
  const document = fixtureCurriculumDocument();
  const modelClient = {
    async extractStructured() {
      return {
        data: knowledgeCompetencyOutput({
          knowledgeBlockIds: ["standard_linear_definition"],
          competencyBlockIds: ["standard_linear_representation"],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, modelClient });

  assert.deepEqual(result.candidates.typed_relations, []);
});

test("does not duplicate a model-supplied develops_competency edge", async () => {
  const document = fixtureCurriculumDocument();
  const modelClient = {
    async extractStructured() {
      return {
        data: knowledgeCompetencyOutput({
          relations: [{
            proposal_id: "relation:representation_develops_abstraction",
            source_ref: "kp:linear_function_representation",
            target_ref: "competency:mathematical_abstraction",
            relation_type: "develops_competency",
            scope: "same_framework",
            basis: "inferred",
            confidence: 0.84,
            source_refs: sourceRefs("standard_linear_definition"),
          }],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, modelClient });

  assert.equal(result.candidates.typed_relations.length, 1);
  assert.equal(
    result.candidates.typed_relations[0].id,
    result.proposal_id_map["relation:representation_develops_abstraction"],
  );
  assert.equal(result.candidates.typed_relations[0].review_status, "needs_review");
});

test("rejects non-empty question-dependent output for a batch without questions", async () => {
  const document = fixtureCurriculumDocument();
  const modelClient = {
    async extractStructured() {
      return {
        data: emptyOutput({ question_links: [{}] }),
      };
    },
  };

  await assert.rejects(
    compileEducationSemanticProposals({ documentIR: document, modelClient }),
    (error) => error.code === "education_semantic_model_output_invalid"
      && /question_links must be empty when the batch contains no questions/u.test(error.message),
  );
});

test("withholds canonical-ID claims, unknown endpoints, and unknown question versions", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  const question = pack.candidates.questions[0];
  const modelClient = {
    async extractStructured() {
      return {
        data: emptyOutput({
          entities: [
            {
              proposal_id: "kp:valid_local",
              entity_type: "knowledge_point",
              display_name: "有效本地知识点",
              statement: "根据题干识别给定的函数表达式。",
              action_verb: "识别",
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.9,
              source_refs: sourceRefs("question_linear_1"),
            },
            {
              proposal_id: "kp:canonical_wikidata_q123",
              entity_type: "knowledge_point",
              display_name: "伪造规范知识点",
              statement: "不能进入候选区。",
              action_verb: null,
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "inferred",
              confidence: 0.99,
              source_refs: sourceRefs("question_linear_1"),
              canonical_ontology_id: "Q123",
            },
          ],
          relations: [{
            proposal_id: "relation:unknown_endpoint",
            source_ref: "kp:not_supplied",
            target_ref: "kp:valid_local",
            relation_type: "prerequisite_of",
            scope: "same_framework",
            basis: "inferred",
            confidence: 0.9,
            source_refs: sourceRefs("question_linear_1"),
          }],
          question_links: [{
            proposal_id: "question_link:wrong_revision",
            question_id: question.id,
            question_revision_id: "wrong_revision",
            part_id: question.parts[0].id,
            knowledge_proposal_id: "kp:valid_local",
            relation: "assesses",
            role: "primary",
            weight: 1,
            observable_indicator: "识别函数表达式",
            confidence: 0.9,
            source_refs: sourceRefs("question_linear_1"),
          }],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, candidatePack: pack, modelClient });

  assert.equal(result.candidates.curriculum_standards.length, 1);
  assert.equal(result.candidates.typed_relations.length, 0);
  assert.equal(result.candidates.question_knowledge_links.length, 0);
  assert.equal(Object.hasOwn(result.proposal_id_map, "kp:canonical_wikidata_q123"), false);
  assert.equal(JSON.stringify(result.candidates).includes("Q123"), false);
  const reasons = result.review_queue.flatMap((item) => item.reasons).join("\n");
  assert.match(reasons, /unexpected field canonical_ontology_id/);
  assert.match(reasons, /canonical or external ontology identity/);
  assert.match(reasons, /source_ref is unknown/);
  assert.match(reasons, /question_revision_id does not match/);
});

test("low-confidence proposals remain reviewable and anchorless proposals never enter contract collections", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  const modelClient = {
    async extractStructured() {
      return {
        data: emptyOutput({
          entities: [
            {
              proposal_id: "kp:low_confidence",
              entity_type: "knowledge_point",
              display_name: "低置信知识点",
              statement: "识别函数中的自变量。",
              action_verb: "识别",
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.4,
              source_refs: sourceRefs("question_linear_1"),
            },
            {
              proposal_id: "kp:no_anchor",
              entity_type: "knowledge_point",
              display_name: "无锚点知识点",
              statement: "没有证据锚点时不能进入合同候选。",
              action_verb: null,
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "inferred",
              confidence: 0.95,
              source_refs: [],
            },
          ],
        }),
      };
    },
  };

  const result = await compileEducationSemanticProposals({ documentIR: document, candidatePack: pack, modelClient });

  assert.equal(result.candidates.curriculum_standards.length, 1);
  assert.equal(result.candidates.curriculum_standards[0].review_status, "needs_review");
  assert.equal(Object.hasOwn(result.proposal_id_map, "kp:no_anchor"), false);
  assert.match(result.review_queue.flatMap((item) => item.reasons).join("\n"), /source_refs must contain/);
});

test("candidate-pack merge is non-mutating and keeps extension proposals outside strict collections", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  const snapshot = structuredClone(pack);
  const modelClient = {
    async extractStructured() {
      return {
        model: "semantic-model",
        requestId: "semantic-request-merge",
        usage: { total_tokens: 30 },
        data: emptyOutput({
          entities: [{
            proposal_id: "kp:merge_target",
            entity_type: "knowledge_point",
            display_name: "代入求值",
            statement: "将自变量值代入一次函数表达式。",
            action_verb: "计算",
            knowledge_form: "procedure",
            aliases: [],
            parent_proposal_id: null,
            basis: "explicit",
            confidence: 0.9,
            source_refs: sourceRefs("question_linear_1"),
          }],
          proposition_angles: [{
            proposal_id: "angle:change_coefficient",
            name: "改变系数",
            description: "改变一次项系数考查同一代入过程。",
            question_ids: [pack.candidates.questions[0].id],
            knowledge_proposal_ids: ["kp:merge_target"],
            basis: "inferred",
            confidence: 0.8,
            source_refs: sourceRefs("question_linear_1"),
          }],
        }),
      };
    },
  };
  const semantic = await compileEducationSemanticProposals({ documentIR: document, candidatePack: pack, modelClient });
  const merged = mergeSemanticProposalsIntoCandidatePack(pack, semantic, {
    updatedAt: "2026-08-17T03:01:00.000Z",
  });

  assert.deepEqual(pack, snapshot, "merge must not mutate the persisted input pack");
  assert.equal(merged.candidate_pack.candidates.curriculum_standards.length, 1);
  assert.equal(Object.hasOwn(merged.candidate_pack.candidates, "proposition_angles"), false);
  assert.equal(merged.semantic_extensions.proposition_angles.length, 1);
  assert.deepEqual(merged.candidate_pack.receipt.model.models, ["semantic-model"]);
  assert.deepEqual(merged.candidate_pack.receipt.model.request_ids, ["semantic-request-merge"]);
  assert.equal(merged.candidate_pack.receipt.model.usage.total_tokens, 30);
});

test("falls back to chatCompletion JSON schema without accepting prose", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  let request;
  const modelClient = {
    async chatCompletion(value) {
      request = value;
      return { text: JSON.stringify(emptyOutput()), model: "chat-model", requestId: "chat-request" };
    },
  };
  const result = await compileEducationSemanticProposals({
    documentIR: document,
    candidatePack: pack,
    modelClient,
    limits: { maxOutputTokens: 50_000 },
  });
  assert.equal(request.responseFormat.type, "json_schema");
  assert.equal(request.responseFormat.json_schema.strict, true);
  assert.equal(request.messages[0].content, EDUCATION_SEMANTIC_COMPILER_INSTRUCTIONS);
  assert.equal(request.maxTokens, 32_768, "caller overrides must remain inside the output-token safety bound");
  assert.equal(result.model_receipt.model, "chat-model");
});

test("marks bounded semantic input as partial instead of reporting a complete batch", async () => {
  const document = fixtureDocument();
  const pack = fixturePack(document);
  const modelClient = {
    async extractStructured() {
      return {
        data: emptyOutput(),
        model: "bounded-input-model",
        requestId: "bounded-input-request",
      };
    },
  };

  const result = await compileEducationSemanticProposals({
    documentIR: document,
    candidatePack: pack,
    modelClient,
    limits: { maxBlocks: 1 },
  });

  assert.equal(result.input_receipt.total_blocks, 2);
  assert.equal(result.input_receipt.supplied_blocks, 1);
  assert.equal(result.input_receipt.truncated, true);
  assert.equal(result.status, "partial");
  assert.ok(result.warnings.some((warning) => warning.code === "semantic_input_truncated"));
});

test("page-scoped compilation filters source blocks and questions and namespaces batch IDs", async () => {
  const document = fixtureTwoPageDocument();
  const pack = fixturePack(document);
  assert.equal(pack.candidates.questions.length, 2);
  const requests = [];
  const modelClient = {
    async extractStructured(request) {
      requests.push(request);
      return {
        model: "batch-model",
        requestId: `batch-request-${requests.length}`,
        data: emptyOutput({
          entities: [
            {
              proposal_id: "kp:batch_local_evaluation",
              entity_type: "knowledge_point",
              display_name: "代入求值",
              statement: "将第二页给出的自变量代入一次函数。",
              action_verb: "计算",
              knowledge_form: "procedure",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.9,
              source_refs: [{ page_index: 1, block_ids: ["question_linear_2"] }],
            },
            {
              proposal_id: "kp:outside_batch",
              entity_type: "knowledge_point",
              display_name: "越界知识点",
              statement: "不允许引用第一批页面。",
              action_verb: null,
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "inferred",
              confidence: 0.9,
              source_refs: [{ page_index: 0, block_ids: ["question_linear_1"] }],
            },
          ],
        }),
      };
    },
  };

  const first = await compileEducationSemanticProposals({
    documentIR: document,
    candidatePack: pack,
    modelClient,
    pageIndexes: [1],
    idNamespace: "semantic-batch-0002",
  });
  const second = await compileEducationSemanticProposals({
    documentIR: document,
    candidatePack: pack,
    modelClient,
    pageIndexes: [1],
    idNamespace: "semantic-batch-0003",
  });

  assert.match(requests[0].input, /"id_namespace":"semantic-batch-0002"/u);
  assert.match(requests[0].input, /"block_id":"question_linear_2"/u);
  assert.equal(requests[0].input.includes('"block_id":"question_linear_1"'), false);
  assert.equal(requests[0].input.includes(pack.candidates.questions[0].id), false);
  assert.equal(requests[0].input.includes(pack.candidates.questions[1].id), true);
  assert.deepEqual(first.input_receipt.page_indexes, [1]);
  assert.equal(first.candidates.curriculum_standards.length, 1);
  assert.match(first.review_queue.flatMap((entry) => entry.reasons).join("\n"), /not on the cited page/u);
  assert.notEqual(
    first.proposal_id_map["kp:batch_local_evaluation"],
    second.proposal_id_map["kp:batch_local_evaluation"],
    "each semantic batch namespace must produce collision-free contract IDs",
  );

  await assert.rejects(
    compileEducationSemanticProposals({
      documentIR: document,
      candidatePack: pack,
      modelClient,
      pageIndexes: [99],
      idNamespace: "semantic-batch-invalid",
    }),
    (error) => error.code === "education_semantic_page_filter_invalid",
  );
});
