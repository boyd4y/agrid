import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isPending, ensureOrganization } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) void ensureOrganization();
  }, [isAuthenticated, ensureOrganization]);

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        检查登录状态…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
