import assert from "node:assert/strict";
import test from "node:test";
import { readQuestionCardInput } from "../src/lib/question-card-input.ts";

const input = {
  allowPartialAnswers: false,
  questions: [{ id: "source", question: "选择来源", options: [{ id: "table", label: "表格" }], allowFreeForm: false }],
};

test("question cards wait for complete SDK-shaped arguments without altering choice IDs", () => {
  assert.equal(readQuestionCardInput(input), input);
  const freeform = { allowPartialAnswers: true, questions: [{ id: "details", question: "补充要求", allowFreeForm: { secret: true } }] };
  assert.equal(readQuestionCardInput(freeform), freeform);
  assert.equal(readQuestionCardInput({ ...input, questions: [{ ...input.questions[0], options: [] }] })?.questions.length, 1);
});

test("partial or malformed streamed questions cannot reach array rendering", () => {
  for (const value of [undefined, null, "{}", {}, { questions: {} }, { ...input, questions: [null] },
    { ...input, questions: [{ id: "source" }] }, { ...input, questions: [input.questions[0], input.questions[0]] }]) {
    assert.equal(readQuestionCardInput(value), undefined);
  }
  for (const options of ["choices", {}, { table: "表格" }, null, [null], ["表格"], [{ id: "table" }], [input.questions[0].options[0], input.questions[0].options[0]]]) {
    assert.equal(readQuestionCardInput({ ...input, questions: [{ ...input.questions[0], options }] }), undefined);
  }
});
