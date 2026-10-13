import { useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/hooks/useAuth";


async function bootstrapOrg(userName: string, userId: string) {
  try {
    const orgs = await authClient.organization.list();
    const list = (orgs.data ?? []) as { id: string }[];
    if (list.length > 0) {
      await authClient.organization.setActive({ organizationId: list[0].id });
      return;
    }
    const created = await authClient.organization.create({
      name: `${userName || "我"}的工作区`,
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
      if (res.error) throw new Error(res.error.message || "登录失败");
      await refetch();
      const u = res.data?.user;
      if (u) await bootstrapOrg(u.name || "", u.id);
      else await ensureOrganization();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">登录</h1>
        <FieldDescription>回到你的工作空间，继续让想法落地。</FieldDescription>
      </div>
      <form onSubmit={onSubmit} aria-busy={busy} aria-describedby={error ? "login-error" : undefined}>
        <FieldGroup className="gap-5">
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="login-email">邮箱</FieldLabel>
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
            <FieldLabel htmlFor="login-password">密码</FieldLabel>
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
              {busy ? "登录中…" : "登录"}
              {!busy && <ArrowRight data-icon="inline-end" />}
            </Button>
            <FieldDescription className="text-center">
              还没有账号？ <Link to="/signup">创建账号</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
