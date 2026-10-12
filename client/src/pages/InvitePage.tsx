import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/hooks/useAuth";

export function InvitePage() {
  const { invitationId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isPending, ensureOrganization } = useAuth();
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (isPending || !invitationId) return;
    if (!isAuthenticated) {
      setMsg("请先登录或注册后再接受邀请");
      return;
    }
    (async () => {
      try {
        const res = await authClient.organization.acceptInvitation({
          invitationId,
        });
        if (res.error) throw new Error(res.error.message || "接受失败");
        await ensureOrganization();
        setStatus("ok");
        setMsg("已加入工作区");
        setTimeout(() => navigate("/app"), 800);
      } catch (e) {
        setStatus("err");
        setMsg(e instanceof Error ? e.message : "接受邀请失败");
      }
    })();
  }, [invitationId, isAuthenticated, isPending, ensureOrganization, navigate]);

  return (
    <div className="mx-auto max-w-sm px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">工作区邀请</h1>
      <p className="mt-3 text-sm text-muted-foreground">{msg || "处理中…"}</p>
      {!isAuthenticated && !isPending && (
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/login" state={{ from: `/invite/${invitationId}` }}>
              登录
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/signup">注册</Link>
          </Button>
        </div>
      )}
      {status === "ok" && (
        <Button asChild className="mt-6" size="sm">
          <Link to="/app">进入工作台</Link>
        </Button>
      )}
    </div>
  );
}
