import { HTTPException } from "hono/http-exception";
import { chatRequestLimits } from "./limits.js";

export type ChatAdmission = { readonly release: () => void };

/** Process-local only: multiple server processes need a shared admission store.
 * User keys deliberately span organizations. Process exit drops all counters.
 */
export function createChatAdmission() {
  const users = new Map<string, number>(), organizations = new Map<string, number>();
  let platform = 0;
  const decrement = (counts: Map<string, number>, key: string) => {
    const next = (counts.get(key) ?? 0) - 1;
    if (next > 0) counts.set(key, next); else counts.delete(key);
  };
  return ({ userId, organizationId }: { userId: string; organizationId: string }): ChatAdmission => {
    const limits = chatRequestLimits();
    const user = users.get(userId) ?? 0, org = organizations.get(organizationId) ?? 0;
    if (user >= limits.concurrentRunsPerUser || org >= limits.concurrentRunsPerOrg || platform >= limits.concurrentRunsPlatform)
      throw new HTTPException(429, { message: "对话并发已达上限，请稍后重试" });
    users.set(userId, user + 1);organizations.set(organizationId, org + 1);platform++;
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;decrement(users, userId);decrement(organizations, organizationId);platform--;
    } };
  };
}

export const acquireChatAdmission = createChatAdmission();
export function releaseChatAdmission(handle: ChatAdmission) { handle.release(); }
