import { useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/hooks/useAuth";
import i18n from "@/i18n";

async function bootstrapOrg(userName: string, userId: string) {
  try {
    const orgs = await authClient.organization.list();
    const list = (orgs.data ?? []) as { id: string }[];
    if (list.length > 0) {
      await authClient.organization.setActive({ organizationId: list[0].id });
      return;
    }
    const fallback = i18n.t("auth:workspaceNameFallback");
    const created = await authClient.organization.create({
      name: i18n.t("auth:workspaceName", { name: userName || fallback }),
      slug: `ws-${userId.slice(0, 8)}`,
    });
    if (created.data?.id) {
      await authClient.organization.setActive({ organizationId: created.data.id });
    }
  } catch (e) {
    console.warn("bootstrapOrg", e);
  }
}

export function SignupPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { ensureOrganization, refetch } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signUp.email({ name, email, password });
      if (res.error) throw new Error(res.error.message || t("signupFailed"));
      await refetch();
      const u = res.data?.user;
      if (u) await bootstrapOrg(u.name || name, u.id);
      else await ensureOrganization();
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signupFailed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("signupTitle")}</h1>
        <FieldDescription>{t("signupDescription")}</FieldDescription>
      </div>
      <form onSubmit={onSubmit} aria-busy={busy} aria-describedby={error ? "signup-error" : undefined}>
        <FieldGroup className="gap-5">
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="signup-name">{t("name")}</FieldLabel>
            <Input
              id="signup-name"
              name="name"
              size="lg"
              required
              autoComplete="name"
              disabled={busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </Field>
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="signup-email">{t("email")}</FieldLabel>
            <Input
              id="signup-email"
              name="email"
              type="email"
              size="lg"
              required
              autoComplete="email"
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="signup-password">{t("password")}</FieldLabel>
            <Input
              id="signup-password"
              name="password"
              type="password"
              size="lg"
              required
              minLength={8}
              autoComplete="new-password"
              aria-describedby="signup-password-hint"
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldDescription id="signup-password-hint">{t("passwordHint")}</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(error)}>
            {error && <FieldError id="signup-error">{error}</FieldError>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />}
              {busy ? t("signupBusy") : t("signupSubmit")}
              {!busy && <ArrowRight data-icon="inline-end" />}
            </Button>
            <FieldDescription className="text-center">
              {t("hasAccount")} <Link to="/login">{t("loginSubmit")}</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
