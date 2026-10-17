import { RadioGroup, RadioGroupItem } from "@tabdo/ui/components/radio-group";
import { ChatRunsContext } from "./ChatRuns";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { makeAssistantToolUI, useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import type { AskUserQuestionAnswer, AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";
import { ArrowLeft, ArrowRight, Check, CircleHelp, LoaderCircle, RotateCw, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@tabdo/ui/components/field";
import { cn } from "@/lib/utils";
import { readQuestionCardInput } from "@/lib/question-card-input";

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
  const [step, setStep] = useState(0);
  const questionTitle = useRef<HTMLLegendElement>(null);
  const focusRequested = useRef(false);
  useEffect(() => {
    if (focusRequested.current) {
      questionTitle.current?.focus();
      focusRequested.current = false;
    }
  }, [step]);
  const input = readQuestionCardInput(args);
  const questions = input?.questions ?? [];
  const provided = Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer.optionIds.length || answer.freeform?.trim()));
  const complete = questions.length > 0 && questions.every(question => provided[question.id]);
  const canSubmit = complete || (input?.allowPartialAnswers && Object.keys(provided).length > 0);
  const activeStep = Math.min(step, questions.length - 1);
  const question = questions[activeStep];
  const current = question && answers[question.id];
  const lastStep = activeStep === questions.length - 1;
  const canAdvance = question && (provided[question.id] || input?.allowPartialAnswers);
  const goToStep = (next: number) => {
    focusRequested.current = true;
    setStep(next);
  };
  const patch = (questionId: string, update: Partial<AskUserQuestionAnswer>) => setAnswers(previous => ({ ...previous, [questionId]: { ...(previous[questionId] ?? { optionIds: [] }), ...update } }));
  if (status.type === "running" && !questions.length) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{t("questions.preparing")}</div>;
  if (!input) return null;
  const submitted = result && "answers" in result ? result.answers : {};
  const options = question.options?.map((option, optionIndex) => {
    const selected = current?.optionIds.includes(option.id) ?? false;
    const optionId = `${id}-${activeStep}-${optionIndex}`;
    return <label key={option.id} htmlFor={optionId} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors hover:bg-accent/50", selected && "border-primary/50 bg-primary/5", running && "cursor-default")}>
      {question.allowMultiple ? <Checkbox id={optionId} disabled={running} className="mt-0.5" checked={selected} onCheckedChange={checked => patch(question.id, { optionIds: checked ? [...(current?.optionIds ?? []), option.id] : (current?.optionIds ?? []).filter(value => value !== option.id) })} />
        : <RadioGroupItem id={optionId} value={option.id} className="mt-0.5" />}
      <span className="min-w-0 flex-1 break-words"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}{option.preview && <span className="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground">{option.preview}</span>}</span>
    </label>;
  });
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4" aria-label={t("questions.title")} data-testid="ask-user-questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium"><CircleHelp className="size-4 text-muted-foreground" />{t(result ? "questions.answered" : "questions.title")}</div>
        {!result && questions.length > 1 && <span role="status" className="text-xs tabular-nums text-muted-foreground">{t("questions.progress", { current: activeStep + 1, total: questions.length })}</span>}
      </div>
      {result ? <dl className="flex flex-col gap-3">
        {questions.filter(question => submitted[question.id]).map(question => {
          const answer = submitted[question.id];
          const secret = typeof question.allowFreeForm === "object" && question.allowFreeForm.secret;
          return <div key={question.id} className="flex flex-col gap-1 text-sm">
            <dt className="font-medium">{question.question}</dt>
            <dd className="flex flex-col gap-1 whitespace-pre-wrap break-words text-muted-foreground">
              {question.options?.filter(option => answer.optionIds.includes(option.id)).map(option => <span key={option.id}>{option.label}</span>)}
              {answer.freeform && <span>{secret ? "••••••" : answer.freeform}</span>}
            </dd>
          </div>;
        })}
      </dl> : <FieldSet key={question.id} className="min-w-0 gap-3" disabled={running}>
          <FieldLegend ref={questionTitle} id={`${id}-question`} tabIndex={-1} variant="label" className="break-words outline-none">{question.question}</FieldLegend>
          <FieldGroup className="gap-3">
          {options?.length ? (question.allowMultiple
              ? <FieldGroup role="group" aria-labelledby={`${id}-question`} className="gap-2">{options}</FieldGroup>
              : <RadioGroup aria-labelledby={`${id}-question`} value={current?.optionIds[0] ?? ""} disabled={running} onValueChange={value => {
                patch(question.id, { optionIds: [value] });
                if (!lastStep) goToStep(activeStep + 1);
              }}>{options}</RadioGroup>) : null}
          {question.allowFreeForm !== false && <Field className="gap-1.5">
            <FieldLabel htmlFor={`${id}-${activeStep}-text`}>{t("questions.freeform")}</FieldLabel>
            {typeof question.allowFreeForm === "object" && question.allowFreeForm.secret
              ? <Input id={`${id}-${activeStep}-text`} type="password" autoComplete="off" value={current?.freeform ?? ""} onChange={event => patch(question.id, { freeform: event.target.value })} />
              : <Textarea id={`${id}-${activeStep}-text`} rows={2} className="min-h-16" value={current?.freeform ?? ""} onChange={event => patch(question.id, { freeform: event.target.value })} />}
          </Field>}
          </FieldGroup>
        </FieldSet>}
      {canRetry && run?.error && <p role="alert" className="text-xs text-destructive">{run.error}</p>}
      {result ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" />{t(result.action === "answered" ? "questions.answered_status" : `questions.${result.action}`)}{canRetry && <Button size="sm" variant="outline" className="ml-auto" disabled={running} onClick={() => addResult(result)}><RotateCw />{t("questions.retry")}</Button>}</div>
        : <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="mr-auto" disabled={running} onClick={() => addResult({ action: "declined" })}><X data-icon="inline-start" />{t("questions.decline")}</Button>
          <div className="flex items-center gap-2">
            {questions.length > 1 && <Button type="button" size="sm" variant="outline" disabled={running || activeStep === 0} onClick={() => goToStep(activeStep - 1)}><ArrowLeft data-icon="inline-start" />{t("questions.previous")}</Button>}
            {lastStep
              ? <Button type="button" size="sm" disabled={running || !canSubmit} onClick={() => addResult({ action: complete ? "answered" : "partially-answered", answers: provided })}><Send data-icon="inline-start" />{t("questions.submit")}</Button>
              : <Button type="button" size="sm" disabled={running || !canAdvance} onClick={() => goToStep(activeStep + 1)}>{t(input.allowPartialAnswers && !provided[question.id] ? "questions.skip" : "questions.next")}<ArrowRight data-icon="inline-end" /></Button>}
          </div>
        </div>}
    </section>
  );
}

export const AskUserQuestionsUI = makeAssistantToolUI<AskUserQuestionsInput, AskUserQuestionsOutput>({ toolName: "askUserQuestions", display: "standalone", render: QuestionsCard });
