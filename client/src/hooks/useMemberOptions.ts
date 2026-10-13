import { useEffect, useState } from "react";
import { api, type MemberOption } from "@/lib/api";

/** Person fields refresh when a member or agent changes, including avatar updates. */
export function useMemberOptions() {
  const [members, setMembers] = useState<MemberOption[]>([]);
  useEffect(() => {
    let disposed = false, version = 0;
    const load = async () => {
      const request = ++version;
      try { const result = await api.listMembers();if (!disposed && version === request) setMembers(result.members ?? []); } catch { /* Keep the last available choices. */ }
    };
    void load();window.addEventListener("tabdo:agents-changed", load);
    return () => { disposed = true;window.removeEventListener("tabdo:agents-changed", load); };
  }, []);
  return members;
}
