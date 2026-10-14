import { InMemoryFs } from "just-bash";
import { workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/backend/checkpoints";
export { workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/backend/checkpoints";

const MAX_BYTES = 32 * 1024 * 1024;
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

/** Only an isolated virtual filesystem is serialized, never the server's disk. */
export async function snapshotWorkspace(
  fs: InMemoryFs,
): Promise<WorkspaceSnapshot> {
  const entries: WorkspaceSnapshot = [];
  let bytes = 0;
  const paths = fs.getAllPaths();
  if (paths.length > 4000)
    throw new Error("智能体工作区文件过多（最多 4000 项）");
  for (const path of paths) {
    const stat = await fs.lstat(path);
    const entry: WorkspaceSnapshot[number] = {
      path,
      mode: stat.mode & 0o7777,
      type: stat.isDirectory
        ? "directory"
        : stat.isSymbolicLink
          ? "symlink"
          : "file",
    };
    if (entry.type === "file") {
      const content = await fs.readFileBuffer(path);
      bytes += content.byteLength;
      if (bytes > MAX_BYTES)
        throw new Error("智能体工作区超过 32 MB，请先清理生成的文件");
      entry.content = encodeBase64(content);
    } else if (entry.type === "symlink") entry.target = await fs.readlink(path);
    entries.push(entry);
  }
  return workspaceSnapshotSchema.parse(entries);
}

export async function restoreWorkspace(
  snapshot?: WorkspaceSnapshot | null,
  options?: { createBytes?: (bytes: Uint8Array) => Uint8Array },
): Promise<InMemoryFs> {
  const fs = new InMemoryFs();
  const entries = workspaceSnapshotSchema.parse(snapshot ?? []);
  let bytes = 0;
  const seen = new Set<string>();
  // Links are restored last so no file restoration can write through a link.
  for (const entry of [...entries].sort(
    (a, b) =>
      Number(a.type === "symlink") - Number(b.type === "symlink") ||
      a.path.length - b.path.length,
  )) {
    if (
      !entry.path.startsWith("/") || entry.path.includes("//") ||
      entry.path.split("/").some((part) => part === "." || part === "..") ||
      entry.path.includes("\0") ||
      seen.has(entry.path) ||
      (entry.path === "/" && entry.type !== "directory")
    )
      throw new Error("智能体工作区快照路径无效");
    seen.add(entry.path);
    if (entry.type === "directory")
      await fs.mkdir(entry.path, { recursive: true });
    else if (entry.type === "symlink") {
      if (entry.target == null || entry.target.includes("\0"))
        throw new Error("智能体工作区链接无效");
      await fs.symlink(entry.target, entry.path);
    } else {
      if (entry.content == null) throw new Error("智能体工作区文件内容无效");
      if (entry.content.length > Math.ceil((MAX_BYTES - bytes) / 3) * 4)
        throw new Error("智能体工作区超过 32 MB");
      let content: Uint8Array;
      try { content = Uint8Array.from(atob(entry.content), character => character.charCodeAt(0)); }
      catch { throw new Error("智能体工作区文件内容无效"); }
      if (encodeBase64(content) !== entry.content)
        throw new Error("智能体工作区文件内容无效");
      bytes += content.byteLength;
      if (bytes > MAX_BYTES) throw new Error("智能体工作区超过 32 MB");
      await fs.writeFile(entry.path, options?.createBytes ? options.createBytes(content) : content);
    }
    if (entry.type !== "symlink") await fs.chmod(entry.path, entry.mode);
  }
  await fs.mkdir("/workspace", { recursive: true });
  return fs;
}
