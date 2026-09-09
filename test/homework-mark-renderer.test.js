import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeHomeworkMark,
  resolveHomeworkImageSize,
} from "../public/homework-mark-renderer.js";

function polygon(x, y, width = 20, height = 10) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

test("maps the server homework protocol to the renderer model", () => {
  const mark = normalizeHomeworkMark({
    schema_version: "homework_mark@1.0",
    preprocessed_image_url: "https://images.example.test/preprocessed.jpg",
    questions: [{
      question_id: "question-7",
      finished: true,
      polygon: polygon(10, 20, 200, 80),
      answers: [{
        answer_id: "answer-1",
        polygon: polygon(80, 60),
        correct: false,
      }],
      solution_text: "先找到一次函数与 x 轴的交点。",
    }],
  });

  assert.equal(mark.sourceImage.url, "https://images.example.test/preprocessed.jpg");
  assert.equal(mark.questions[0].id, "question-7");
  assert.equal(mark.questions[0].order, 1);
  assert.equal(mark.questions[0].verdict, "wrong");
  assert.equal(mark.questions[0].analysis, "先找到一次函数与 x 轴的交点。");
  assert.equal(mark.questions[0].polygon.points.length, 4);
  assert.equal(mark.questions[0].answers[0].polygon.points.length, 4);
});

test("also accepts direct provider mark_results and answer_results polygons", () => {
  const mark = normalizeHomeworkMark({
    preprocessed_image_url: "https://images.example.test/direct.jpg",
    mark_results: [{
      mark_id: "provider-question-2",
      finish: true,
      mark_points: polygon(5, 8),
      answer_results: [{
        id: 0,
        answer_points: polygon(9, 10),
        correct: true,
      }],
      solution_text: "答案与解析",
    }],
  });

  assert.equal(mark.questions[0].id, "provider-question-2");
  assert.equal(mark.questions[0].verdict, "correct");
  assert.equal(mark.questions[0].answers[0].id, "0");
  assert.equal(mark.questions[0].answers[0].correct, true);
  assert.deepEqual(mark.questions[0].answers[0].polygon.points[0], [9, 10]);
});

test("finished questions without answer regions render as unanswered", () => {
  const mark = normalizeHomeworkMark({
    questions: [{ question_id: "blank", finished: true, polygon: polygon(0, 0) }],
  });
  assert.equal(mark.questions[0].verdict, "unanswered");
});

test("natural image dimensions take precedence for the SVG coordinate space", () => {
  assert.deepEqual(
    resolveHomeworkImageSize(
      { naturalWidth: 2_142, naturalHeight: 1_500 },
      { width: 800, height: 600 },
    ),
    { width: 2_142, height: 1_500 },
  );
  assert.deepEqual(
    resolveHomeworkImageSize({}, { width: 800, height: 600 }),
    { width: 800, height: 600 },
  );
});

test("never overlays preprocessed-image coordinates on the uploaded original fallback", () => {
  const fallbackImageUrl = "data:image/png;base64,aGVsbG8=";
  const mark = normalizeHomeworkMark({
    schema_version: "homework_mark@1.0",
    questions: [{
      question_id: "question-without-corrected-image",
      finished: true,
      polygon: polygon(10, 20, 200, 80),
      answers: [],
    }],
  }, { fallbackImageUrl });

  assert.equal(mark.sourceImage.url, fallbackImageUrl);
  assert.equal(mark.sourceImage.displayMode, "original_fallback");
  assert.equal(mark.sourceImage.coordinateCompatible, false);
  assert.equal(mark.coordinateStatus, "preprocessed_image_unavailable");
  assert.equal(mark.degradation.code, "preprocessed_image_unavailable");
  assert.match(mark.degradation.message, /坐标标注已隐藏/u);
});

test("rejects a non-HTTPS coordinate image and makes the fallback degradation explicit", () => {
  const mark = normalizeHomeworkMark({
    preprocessed_image_url: "http://images.example.test/corrected.jpg",
    questions: [{
      question_id: "unsafe-corrected-image",
      finished: true,
      polygon: polygon(1, 2),
    }],
  }, {
    fallbackImageUrl: "blob:https://app.example.test/uploaded-original",
  });

  assert.equal(mark.sourceImage.url, "blob:https://app.example.test/uploaded-original");
  assert.equal(mark.sourceImage.coordinateUrl, "");
  assert.equal(mark.sourceImage.coordinateCompatible, false);
  assert.equal(mark.coordinateStatus, "preprocessed_image_url_rejected");
});

test("uses the corrected image for coordinates even when an original fallback is available", () => {
  const mark = normalizeHomeworkMark({
    preprocessed_image_url: "https://images.example.test/corrected.jpg",
    questions: [{
      question_id: "safe-corrected-image",
      finished: true,
      polygon: polygon(1, 2),
    }],
  }, {
    fallbackImageUrl: "data:image/png;base64,aGVsbG8=",
  });

  assert.equal(mark.sourceImage.url, "https://images.example.test/corrected.jpg");
  assert.equal(mark.sourceImage.coordinateCompatible, true);
  assert.equal(mark.sourceImage.displayMode, "preprocessed");
  assert.equal(mark.coordinateStatus, "ready");
  assert.equal(mark.degradation, null);
});

test("routes homework explanations and every solution step through the shared rich-text renderer", async () => {
  const [rendererSource, html] = await Promise.all([
    readFile(new URL("../public/homework-mark-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(rendererSource, /import \{ renderAgentAnswer \} from "\.\/agent-answer-renderer\.js"/u);
  assert.match(rendererSource, /renderAgentAnswer\(content, null, text\)/u);
  assert.match(rendererSource, /question\.solution\.forEach[\s\S]*?renderAgentAnswer\(content, null, step\)/u);
  assert.doesNotMatch(rendererSource, /question\.solution\.forEach\(\(step\) => list\.append\(copyNode/u);
  assert.match(html, /vendor\/katex\/katex\.min\.css/u);
  assert.match(html, /vendor\/katex\/katex\.min\.js/u);
});
