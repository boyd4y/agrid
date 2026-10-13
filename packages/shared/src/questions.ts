/** Canonical question shapes exposed by Harness's askUserQuestions tool. */
export type AskUserQuestionOption = { id: string; label: string; description?: string; preview?: string };
export type AskUserQuestion = {
  id: string;
  question: string;
  header?: string;
  options?: AskUserQuestionOption[];
  allowMultiple?: boolean;
  allowFreeForm?: boolean | { secret: boolean };
};
export type AskUserQuestionsInput = { allowPartialAnswers: boolean; questions: AskUserQuestion[] };
export type AskUserQuestionAnswer = { optionIds: string[]; freeform?: string };
export type AskUserQuestionsOutput =
  | { action: "answered" | "partially-answered"; answers: Record<string, AskUserQuestionAnswer> }
  | { action: "declined" | "cancelled" };

/** An answer continues the existing native turn; it adds no user prompt. */
export type NativeQuestionResultRequest = {
  intent: "tool-result";
  assistantMessageId: string;
  toolResults: { toolCallId: string; output: AskUserQuestionsOutput }[];
};
