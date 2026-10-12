import { Navigate } from "react-router-dom";

/** @deprecated Use AppShell routes under /app */
export function WorkspaceApp() {
  return <Navigate to="/app" replace />;
}
