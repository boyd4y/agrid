import { useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
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

export function SignupPage() {
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
      if (res.error) throw new Error(res.error.message || "注册失败");
      await refetch();
      const u = res.data?.user;
      if (u) await bootstrapOrg(u.name || name, u.id);
      else await ensureOrganization();
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">创建账号</h1>
        <FieldDescription>给想法一个空间，让 AI 帮你迈出下一步。</FieldDescription>
      </div>
      <form onSubmit={onSubmit} aria-busy={busy} aria-describedby={error ? "signup-error" : undefined}>
        <FieldGroup className="gap-5">
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="signup-name">名字</FieldLabel>
            <Input
              id="signup-name"
              name="name"
              size="lg"
              required
              autoComplete="name"
              disabled={busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名字"
            />
          </Field>
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="signup-email">邮箱</FieldLabel>
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
            <FieldLabel htmlFor="signup-password">密码</FieldLabel>
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
            <FieldDescription id="signup-password-hint">至少 8 个字符。</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(error)}>
            {error && <FieldError id="signup-error">{error}</FieldError>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />}
              {busy ? "创建中…" : "创建账号"}
              {!busy && <ArrowRight data-icon="inline-end" />}
            </Button>
            <FieldDescription className="text-center">
              已有账号？ <Link to="/login">登录</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
