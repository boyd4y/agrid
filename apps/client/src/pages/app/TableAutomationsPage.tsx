import { Navigate, useParams } from "react-router-dom";
/** Old bookmarks lead to the independent creation flow, retaining only the source. */
export function TableAutomationsPage() {
  const { tableId } = useParams();
  return <Navigate replace to={`/app/automations/new?source=${encodeURIComponent(tableId ?? "")}`} />;
}
