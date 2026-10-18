import { useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/hooks/useAuth";
import i18n from "@/i18n";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";

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

export function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/app";
  const { ensureOrganization, refetch } = useAuth();
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
      const res = await authClient.signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message || t("loginFailed"));
      await refetch();
      const u = res.data?.user;
      if (u) await bootstrapOrg(u.name || "", u.id);
      else await ensureOrganization();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("loginTitle")}</h1>
        <FieldDescription>{t("loginDescription")}</FieldDescription>
      </div>
      <form noValidate onSubmit={onSubmit} aria-busy={busy} aria-describedby={error ? "login-error" : undefined}>
        <FieldGroup className="gap-5">
          <GoogleSignIn callbackURL={from} disabled={busy} />
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="login-email">{t("email")}</FieldLabel>
            <Input
              id="login-email"
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
            <FieldLabel htmlFor="login-password">{t("password")}</FieldLabel>
            <Input
              id="login-password"
              name="password"
              type="password"
              size="lg"
              required
              minLength={8}
              autoComplete="current-password"
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field data-invalid={Boolean(error)}>
            {error && <FieldError id="login-error">{error}</FieldError>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />}
              {busy ? t("loginBusy") : t("loginSubmit")}
              {!busy && <ArrowRight data-icon="inline-end" />}
            </Button>
            <FieldDescription className="text-center">
              {t("noAccount")} <Link to="/signup">{t("createAccount")}</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
