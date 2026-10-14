import { HTTPException } from "hono/http-exception";

function limit(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
export function createUploadBudgets(env: NodeJS.ProcessEnv = process.env) {
  let active = 0;
  const organizations = new Map<string, { active: number; bytes: number }>();
  return {
    acquire(organizationId: string) {
      const org = organizations.get(organizationId) ?? { active: 0, bytes: 0 };
      if (active >= limit(env, "FILE_UPLOAD_MAX_CONCURRENT", 4) || org.active >= limit(env, "FILE_UPLOAD_MAX_CONCURRENT_PER_ORG", 2))
        throw new HTTPException(429, { message: "上传繁忙，请稍后重试" });
      active++; org.active++; organizations.set(organizationId, org);
      let released = false, reserved = 0;
      return {
        reserve(bytes: number, storedBytes: number) {
          if (released || reserved || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid upload reservation");
          const quota = limit(env, "FILE_STORAGE_ORG_QUOTA_BYTES", 1024 ** 3);
          if (quota && storedBytes + org.bytes + bytes > quota) throw new HTTPException(413, { message: "工作区文件存储超过限制" });
          reserved = bytes; org.bytes += bytes;
        },
        release() {
          if (released) return;
          released = true; active--; org.active--; org.bytes -= reserved;
          if (!org.active) organizations.delete(organizationId);
        },
      };
    },
  };
}
export const uploadBudgets = createUploadBudgets();
