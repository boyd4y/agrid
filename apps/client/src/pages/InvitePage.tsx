import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@tabdo/ui/components/button";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";

export function InvitePage() {
  const { t } = useTranslation("common");
  const { invitationId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isPending, ensureOrganization } = useAuth();
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (isPending || !invitationId) return;
    if (!isAuthenticated) {
      setMsg(t("inviteLoginFirst"));
      return;
    }
    (async () => {
      try {
        const res = await authClient.organization.acceptInvitation({
          invitationId,
        });
        if (res.error) throw new Error(res.error.message || t("inviteAcceptFailed"));
        await ensureOrganization();
        setStatus("ok");
        setMsg(t("inviteJoined"));
        setTimeout(() => navigate("/app"), 800);
      } catch (e) {
        setStatus("err");
        setMsg(e instanceof Error ? e.message : t("inviteAcceptError"));
      }
    })();
  }, [invitationId, isAuthenticated, isPending, ensureOrganization, navigate, t]);

  return (
    <div className="mx-auto max-w-sm px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">{t("inviteTitle")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{msg || t("processing")}</p>
      {!isAuthenticated && !isPending && (
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/login" state={{ from: `/invite/${invitationId}` }}>
              {t("login")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/signup">{t("signup")}</Link>
          </Button>
        </div>
      )}
      {status === "ok" && (
        <Button asChild className="mt-6" size="sm">
          <Link to="/app">{t("enterWorkspace")}</Link>
        </Button>
      )}
    </div>
  );
}
