import { resolveActor, type Actor } from "../auth/actor.js";

export async function requireActorOrg(req: Request): Promise<
  | { ok: true; actor: Actor; organizationId: string }
  | { ok: false; status: 401; error: string }
> {
  const actor = await resolveActor(req);
  const organizationId = actor?.organizationId?.trim() || "";
  if (!actor || !organizationId) {
    return { ok: false, status: 401, error: "缺少组织上下文：请先登录并选择工作区" };
  }
  return { ok: true, actor, organizationId };
}
