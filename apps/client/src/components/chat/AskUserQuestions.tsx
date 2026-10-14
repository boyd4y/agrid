import { RadioGroup, RadioGroupItem } from "@tabdo/ui/components/radio-group";
import { ChatRunsContext } from "./ChatRuns";
import { useContext, useId, useState } from "react";
import { makeAssistantToolUI, useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import type { AskUserQuestionAnswer, AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";
import { Check, CircleHelp, LoaderCircle, RotateCw, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { cn } from "@/lib/utils";

/** SDK question UI; ordinary assistant prose stays ordinary prose. */
export function QuestionsCard({ args, result, status, addResult, toolCallId }: ToolCallMessagePartProps<AskUserQuestionsInput, AskUserQuestionsOutput>) {
  const { t } = useTranslation("chat");
  const id = useId();
  const running = useAuiState(s => s.thread.isRunning);
  const messageId = useAuiState(s => s.message.id);
  const failed = useAuiState(s => { const latest = s.thread.messages.at(-1)?.status; return latest?.type === "incomplete" && latest.reason === "error"; });
  const { runs } = useContext(ChatRunsContext);
  const run = runs.find(run => run.assistantMessageId === messageId);
  const canRetry = Boolean(result && run?.pendingQuestionCallIds?.includes(toolCallId) && (failed || run.status === "failed" || run.status === "cancelled"));
  const [answers, setAnswers] = useState<Record<string, AskUserQuestionAnswer>>({});
  const questions = args.questions ?? [];
  const provided = Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer.optionIds.length || answer.freeform?.trim()));
  const complete = questions.length > 0 && questions.every(question => provided[question.id]);
  const canSubmit = complete || (args.allowPartialAnswers && Object.keys(provided).length > 0);
  const patch = (questionId: string, update: Partial<AskUserQuestionAnswer>) => setAnswers(previous => ({ ...previous, [questionId]: { ...(previous[questionId] ?? { optionIds: [] }), ...update } }));
  if (status.type === "running" && !questions.length) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{t("questions.preparing")}</div>;
  const submitted = result && "answers" in result ? result.answers : {};
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label={t("questions.title")} data-testid="ask-user-questions">
      <div className="flex items-center gap-2 text-sm font-medium"><CircleHelp className="size-4 text-muted-foreground" />{t(result ? "questions.answered" : "questions.title")}</div>
      {questions.map((question, index) => {
        const current = result ? submitted[question.id] : answers[question.id];
        const freeform = current?.freeform ?? "";
        const secret = typeof question.allowFreeForm === "object" && question.allowFreeForm.secret;
        return <fieldset key={question.id} className="space-y-2" disabled={Boolean(result) || running}>
          <legend className="mb-2 text-sm font-medium">{question.question}</legend>
          <RadioGroup role={question.allowMultiple ? "group" : undefined} value={question.allowMultiple ? undefined : current?.optionIds[0] ?? ""} disabled={Boolean(result) || running} onValueChange={value => { if (!question.allowMultiple) patch(question.id, { optionIds: [value] }); }}>
          {question.options?.map((option, optionIndex) => {
            const selected = current?.optionIds.includes(option.id) ?? false;
            const optionId = `${id}-${index}-${optionIndex}`;
            return <label key={option.id} htmlFor={optionId} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors hover:bg-accent/50", selected && "border-primary/50 bg-primary/5", (result || running) && "cursor-default")}>
              {question.allowMultiple ? <Checkbox id={optionId} className="mt-0.5" checked={selected} onCheckedChange={checked => patch(question.id, { optionIds: checked ? [...(current?.optionIds ?? []), option.id] : (current?.optionIds ?? []).filter(value => value !== option.id) })} />
                : <RadioGroupItem id={optionId} value={option.id} className="mt-0.5" />}
              <span className="min-w-0 flex-1"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}{option.preview && <span className="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground">{option.preview}</span>}</span>
            </label>;
          })}</RadioGroup>
          {question.allowFreeForm !== false && <div className="space-y-1.5"><label htmlFor={`${id}-${index}-text`} className="text-xs text-muted-foreground">{t("questions.freeform")}</label>
            {secret ? <Input id={`${id}-${index}-text`} type="password" autoComplete="off" value={freeform} onChange={event => patch(question.id, { freeform: event.target.value })} /> : <Textarea id={`${id}-${index}-text`} rows={2} className="min-h-16" value={freeform} onChange={event => patch(question.id, { freeform: event.target.value })} />}
          </div>}
        </fieldset>;
      })}
      {canRetry && run?.error && <p role="alert" className="text-xs text-destructive">{run.error}</p>}
      {result ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" />{t(result.action === "answered" ? "questions.answered_status" : `questions.${result.action}`)}{canRetry && <Button size="sm" variant="outline" className="ml-auto" disabled={running} onClick={() => addResult(result)}><RotateCw />{t("questions.retry")}</Button>}</div>
        : <div className="flex items-center justify-end gap-2"><Button size="sm" variant="ghost" disabled={running || !questions.length} onClick={() => addResult({ action: "declined" })}><X />{t("questions.decline")}</Button><Button size="sm" disabled={running || !canSubmit} onClick={() => addResult({ action: complete ? "answered" : "partially-answered", answers: provided })}><Send />{t("questions.submit")}</Button></div>}
    </section>
  );
}

export const AskUserQuestionsUI = makeAssistantToolUI<AskUserQuestionsInput, AskUserQuestionsOutput>({ toolName: "askUserQuestions", display: "standalone", render: QuestionsCard });
