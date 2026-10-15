import { workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/backend/checkpoints";
export { workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/backend/checkpoints";

/** Disk snapshot capabilities; implementations own Node filesystem access. */
export interface SnapshotWorkspace {
  readonly root: string;
  getAllPaths(): string[];
  lstat(path: string): Promise<{ mode: number; size: number; isDirectory: boolean; isSymbolicLink: boolean; isFile: boolean }>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  readlink(path: string): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  dispose(): Promise<void>;
}

const MAX_BYTES = 32 * 1024 * 1024;
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

/** Snapshot entry paths use a stable logical root across temporary directories. */
function logicalPath(fs: SnapshotWorkspace, path: string): string {
  if (path === fs.root) return "/";
  if (!path.startsWith(`${fs.root}/`)) throw new Error("智能体工作区快照路径无效");
  return path.slice(fs.root.length);
}
function validPath(path: string): boolean {
  return path.startsWith("/") && !path.includes("//") && !path.includes("\0") &&
    !path.split("/").some(part => part === "." || part === "..");
}
function diskPath(fs: SnapshotWorkspace, path: string): string {
  if (!validPath(path)) throw new Error("智能体工作区快照路径无效");
  return path === "/" ? fs.root : `${fs.root}${path}`;
}
function parentPath(path: string): string { return path.slice(0, path.lastIndexOf("/")) || "/"; }
function validateLink(path: string, target: string): void {
  if (!target || target.includes("\0")) throw new Error("智能体工作区链接无效");
  const parts = target.startsWith("/") ? [] : parentPath(path).split("/").filter(Boolean);
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("智能体工作区链接无效");parts.pop(); }
    else parts.push(part);
  }
}

/** Traverse only the owned disk root. Links are recorded, never traversed. */
export async function snapshotWorkspace(fs: SnapshotWorkspace): Promise<WorkspaceSnapshot> {
  const entries: WorkspaceSnapshot = [];
  let bytes = 0;
  const paths = fs.getAllPaths();
  if (paths.length > 4000) throw new Error("智能体工作区文件过多（最多 4000 项）");
  for (const path of paths) {
    const logical = logicalPath(fs, path);
    if (!validPath(logical)) throw new Error("智能体工作区快照路径无效");
    const stat = await fs.lstat(path);
    if (!stat.isDirectory && !stat.isSymbolicLink && !stat.isFile) throw new Error("智能体工作区包含不支持的文件类型");
    const entry: WorkspaceSnapshot[number] = { path: logical, mode: stat.mode & 0o7777,
      type: stat.isDirectory ? "directory" : stat.isSymbolicLink ? "symlink" : "file" };
    if (entry.type === "file") {
      if (typeof stat.size === "number" && stat.size > MAX_BYTES - bytes) throw new Error("智能体工作区超过 32 MB，请先清理生成的文件");
      const content = await fs.readFileBuffer(path);
      bytes += content.byteLength;
      if (bytes > MAX_BYTES) throw new Error("智能体工作区超过 32 MB，请先清理生成的文件");
      entry.content = encodeBase64(content);
    } else if (entry.type === "symlink") {
      const target = await fs.readlink(path);
      entry.target = target.startsWith("/") ? logicalPath(fs, target) : target;
      validateLink(logical, entry.target);
    }
    entries.push(entry);
  }
  return workspaceSnapshotSchema.parse(entries);
}

export async function restoreWorkspace<Workspace extends SnapshotWorkspace>(
  snapshot: WorkspaceSnapshot | null | undefined,
  options: { createWorkspace(): Promise<Workspace> },
): Promise<Workspace> {
  const entries = workspaceSnapshotSchema.parse(snapshot ?? []);
  const seen = new Set<string>();
  const links = new Set(entries.filter(entry => entry.type === "symlink").map(entry => entry.path));
  let bytes = 0;
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (!validPath(entry.path) || seen.has(entry.path) || (entry.path === "/" && entry.type !== "directory"))
      throw new Error("智能体工作区快照路径无效");
    seen.add(entry.path);
    let parent = parentPath(entry.path);
    while (parent !== "/") {
      if (links.has(parent)) throw new Error("智能体工作区快照路径无效");
      parent = parentPath(parent);
    }
    if (entry.type === "symlink") {
      if (entry.target == null) throw new Error("智能体工作区链接无效");
      validateLink(entry.path, entry.target);
    } else if (entry.type === "file") {
      if (entry.content == null) throw new Error("智能体工作区文件内容无效");
      if (entry.content.length > Math.ceil((MAX_BYTES - bytes) / 3) * 4) throw new Error("智能体工作区超过 32 MB");
      let content: Uint8Array;
      try { content = Uint8Array.from(atob(entry.content), character => character.charCodeAt(0)); }
      catch { throw new Error("智能体工作区文件内容无效"); }
      if (encodeBase64(content) !== entry.content) throw new Error("智能体工作区文件内容无效");
      bytes += content.byteLength;
      if (bytes > MAX_BYTES) throw new Error("智能体工作区超过 32 MB");
      files.set(entry.path, content);
    }
  }
  const fs = await options.createWorkspace();
  try {
    // Rebase the previous virtual '/' and all later disk roots to this new root.
    // Absolute link targets are rebased too; relative links retain their meaning.
    for (const entry of [...entries].sort((a, b) => Number(a.type === "symlink") - Number(b.type === "symlink") || a.path.length - b.path.length)) {
      const path = diskPath(fs, entry.path);
      if (entry.type === "directory") await fs.mkdir(path, { recursive: true });
      else {
        await fs.mkdir(diskPath(fs, parentPath(entry.path)), { recursive: true });
        if (entry.type === "symlink") await fs.symlink(entry.target!.startsWith("/") ? diskPath(fs, entry.target!) : entry.target!, path);
        else { await fs.writeFile(path, files.get(entry.path)!);await fs.chmod(path, entry.mode); }
      }
    }
    await fs.mkdir(`${fs.root}/workspace`, { recursive: true });
    // Read-only directory modes are restored after their children are written.
    for (const entry of [...entries].filter(entry => entry.type === "directory").sort((a, b) => b.path.length - a.path.length))
      // A previous virtual root's public mode must not expose the new host directory.
      await fs.chmod(diskPath(fs, entry.path), entry.path === "/" ? 0o700 : entry.mode);
    return fs;
  } catch (error) { await fs.dispose();throw error; }
}
