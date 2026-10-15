import type { AskUserQuestionsInput } from "@tabdo/shared";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const optionalText = (value: unknown) => value === undefined || typeof value === "string";

/** Tool arguments can be partial while streaming, regardless of their static type.
 * This is a rendering readiness check; the server still uses the SDK's schema.
 * Never coerce malformed choices or invent IDs that the continuation cannot accept.
 */
export function readQuestionCardInput(value: unknown): AskUserQuestionsInput | undefined {
  if (!record(value) || typeof value.allowPartialAnswers !== "boolean"
    || !Array.isArray(value.questions) || !value.questions.length) return;
  const ids = new Set<string>();
  for (const question of value.questions) {
    if (!record(question) || !text(question.id) || ids.has(question.id) || !text(question.question)
      || !optionalText(question.header)
      || (question.allowMultiple !== undefined && typeof question.allowMultiple !== "boolean")) return;
    ids.add(question.id);
    if (question.allowFreeForm !== undefined && typeof question.allowFreeForm !== "boolean"
      && !(record(question.allowFreeForm) && typeof question.allowFreeForm.secret === "boolean")) return;
    if (question.options !== undefined) {
      if (!Array.isArray(question.options)) return;
      const optionIds = new Set<string>();
      for (const option of question.options) {
        if (!record(option) || !text(option.id) || optionIds.has(option.id) || !text(option.label)
          || !optionalText(option.description) || !optionalText(option.preview)) return;
        optionIds.add(option.id);
      }
    }
  }
  return value as AskUserQuestionsInput;
}
