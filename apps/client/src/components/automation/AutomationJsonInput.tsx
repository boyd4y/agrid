import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Field, FieldDescription } from "@tabdo/ui/components/field";
import { useTranslation } from "react-i18next";
const CodeEditor = lazy(() => import("@tabdo/ui/components/code-editor").then(module => ({ default: module.CodeEditor })));
export function AutomationJsonInput({ value, onChange, onInvalidChange, label }: { value: unknown; onChange: (value: unknown) => void; onInvalidChange?: (invalid: boolean) => void; label: string }) {
  const { t } = useTranslation("automation");
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [text, setText] = useState(serialized), [error, setError] = useState(false);
  const sent = useRef(serialized), callback = useRef(onInvalidChange);
  callback.current = onInvalidChange;
  useEffect(() => { if (serialized !== sent.current) { sent.current = serialized; setText(serialized); setError(false); callback.current?.(false); } }, [serialized]);
  useEffect(() => () => callback.current?.(false), []);
  return <Field data-invalid={error}><Suspense fallback={<p role="status">{t("loading")}</p>}><CodeEditor language="json" value={text} aria-label={label} className="h-52" onChange={text => { setText(text); try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); sent.current = JSON.stringify(value, null, 2); setError(false); callback.current?.(false); onChange(value); } catch { setError(true); callback.current?.(true); } }} /></Suspense>{error && <FieldDescription role="alert">{t("generic.invalidJson")}</FieldDescription>}</Field>;
}
