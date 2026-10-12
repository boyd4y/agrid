import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">创建账号</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        注册后自动创建工作区，可邀请同事与 Agent
      </p>
      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
        <div>
          <Label className="mb-1 block">
            名字
          </Label>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Boyd"
          />
        </div>
        <div>
          <Label className="mb-1 block">
            邮箱
          </Label>
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div>
          <Label className="mb-1 block">
            密码（至少 8 位）
          </Label>
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "创建中…" : "注册并进入"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <Link to="/login" className="text-primary hover:underline">
          登录
        </Link>
      </p>
    </div>
  );
}
