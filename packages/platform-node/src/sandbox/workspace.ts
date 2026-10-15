import { lstatSync, readdirSync, realpathSync, type Stats } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, lstat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type DiskWorkspaceStat = {
  mode: number; size: number; mtime: Date; atime: Date; ctime: Date;
  isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean;
};
const workspaceStat = (value: Stats): DiskWorkspaceStat => ({ mode: value.mode, size: value.size,
  mtime: value.mtime, atime: value.atime, ctime: value.ctime,
  isFile: value.isFile(), isDirectory: value.isDirectory(), isSymbolicLink: value.isSymbolicLink() });

/** A real directory, not an OS sandbox. Snapshot paths are translated by the caller. */
export class DiskWorkspace {
  readonly root: string;
  constructor(root: string) {
    this.root = realpathSync(root);
    if (!lstatSync(this.root).isDirectory()) throw new Error("Workspace root must be a directory");
  }
  resolve(path: string): string {
    if (path.includes("\0")) throw new Error("Invalid workspace path");
    const result = resolve(this.root, path), pathRelative = relative(this.root, result);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) throw new Error("Path is outside the workspace root");
    return result;
  }
  /** Check links as well as lexical traversal; this does not constrain shell processes. */
  checked(path: string, followLeaf = true): string {
    const result = this.resolve(path);
    let current = this.root;
    const parts = relative(this.root, result).split(sep).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]);
      if (!followLeaf && index === parts.length - 1) break;
      try {
        if (lstatSync(current).isSymbolicLink()) {
          const target = realpathSync(current);
          this.resolve(target);
          current = target;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // A dangling symbolic link must not become an unchecked write target.
          try { if (lstatSync(current).isSymbolicLink()) throw new Error("Dangling workspace symbolic link"); }
          catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError; }
          break;
        }
        throw error;
      }
    }
    return result;
  }
  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    await mkdir(this.checked(path), options);
  }
  async readFile(path: string): Promise<string> { return (await this.readFileBuffer(path)).toString("utf8"); }
  async readFileBuffer(path: string, options?: { signal?: AbortSignal }): Promise<Buffer> {
    return readFile(this.checked(path), options);
  }
  async writeFile(path: string, content: string | Uint8Array, options?: { signal?: AbortSignal; mode?: number }): Promise<void> {
    const target = this.checked(path);
    await mkdir(this.checked(dirname(target)), { recursive: true });
    await writeFile(this.checked(target), content, options);
  }
  async lstat(path: string): Promise<DiskWorkspaceStat> { return workspaceStat(await lstat(this.checked(path, false))); }
  async stat(path: string): Promise<DiskWorkspaceStat> { return workspaceStat(await stat(this.checked(path))); }
  async chmod(path: string, mode: number): Promise<void> { await chmod(this.checked(path), mode); }
  async symlink(target: string, path: string): Promise<void> {
    const link = this.checked(path, false);
    this.resolve(isAbsolute(target) ? target : resolve(dirname(link), target));
    await symlink(target, link);
  }
  async readlink(path: string): Promise<string> { return readlink(this.checked(path, false)); }
  getAllPaths(): string[] {
    const result: string[] = [];
    const visit = (path: string) => {
      result.push(path);
      if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    };
    visit(this.root);
    return result;
  }
  async dispose(): Promise<void> { await rm(this.root, { recursive: true, force: true }); }
}

export async function createDiskWorkspace(): Promise<DiskWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "tabdo-workspace-"));
  await chmod(root, 0o700);
  return new DiskWorkspace(root);
}
