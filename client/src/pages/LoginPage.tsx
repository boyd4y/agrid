import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
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

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/app";
  const { ensureOrganization, refetch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
      <p className="mt-1 text-sm text-muted-foreground">使用邮箱进入工作台</p>
      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
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
            密码
          </Label>
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        还没有账号？{" "}
        <Link to="/signup" className="text-primary hover:underline">
          注册
        </Link>
      </p>
    </div>
  );
}
