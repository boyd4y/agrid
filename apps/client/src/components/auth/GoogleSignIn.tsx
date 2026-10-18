import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Field, FieldError, FieldSeparator } from "@tabdo/ui/components/field";
import { authClient } from "@/lib/auth-client";

export function GoogleSignIn({ callbackURL, disabled }: { callbackURL: string; disabled: boolean }) {
  const { t } = useTranslation("auth");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/auth-features", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const features = await response.json();
        if (!controller.signal.aborted) setEnabled(features.google === true);
      })
      .catch(() => { /* Unavailable configuration hides the optional provider. */ });
    return () => controller.abort();
  }, []);

  if (!enabled) return null;

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      // Only accept local paths, including when router state is supplied externally.
      const safePath = callbackURL.startsWith("/") && !/^\/[\\/]/.test(callbackURL) && !/[\\\s]/.test(callbackURL)
        ? callbackURL : "/app";
      const result = await authClient.signIn.social({ provider: "google", callbackURL: safePath });
      if (result.error) throw result.error;
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field data-invalid={error} data-disabled={disabled || busy}>
        <Button type="button" variant="outline" size="lg" disabled={disabled || busy} onClick={() => void signIn()}>
          {t("continueWithGoogle")}
        </Button>
        {error && <FieldError>{t("googleFailed")}</FieldError>}
      </Field>
      <FieldSeparator>{t("orDivider")}</FieldSeparator>
    </>
  );
}
