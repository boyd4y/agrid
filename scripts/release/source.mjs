import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { requireRelease, ReleaseError, shaPattern } from "./guards.mjs";

const execute = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const roots = new Set(["Dockerfile.server", ".dockerignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "railway.api.json", "railway.worker.json"]);

export function includedSource(path) {
  const parts = path.split("/");
  if (parts.some(part => !part || part === ".." || part === ".")) return false;
  if (roots.has(path)) return true;
  return /^(apps\/(client|server)|packages|scripts)\//.test(path)
    && !parts.some(part => part.startsWith(".") || ["node_modules", "dist", "test", "tests", "artifacts", "coverage", "screenshots"].includes(part))
    && !/\.(log|pem|key|p12)$/i.test(path);
}

// Read immutable Git objects, never the working tree or ignored local files.
// CLI v5.71.0 does not submit Git metadata; this manifest is upload provenance,
// not a claim that Railway independently attests a Git commit.
export function prepareSource(sha, { cwd = process.cwd(), directory = tmpdir() } = {}) {
  requireRelease(shaPattern.test(sha), "invalid_source_commit");
  const run = (args, options = {}) => execFileSync("git", args, { cwd, timeout: 30000, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options });
  let root;
  try {
    const entries = run(["ls-tree", "-rz", "--full-tree", sha]).toString("utf8").split("\0").filter(Boolean).map(line => {
      const separator = line.indexOf("\t");
      const header = line.slice(0, separator), path = line.slice(separator + 1);
      const [mode, type, oid] = header.split(" ");
      return { mode, type, oid, path };
    }).filter(entry => includedSource(entry.path));
    requireRelease(entries.length > 0 && entries.every(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && !/[\r\n\t\\]/.test(entry.path)), "unsupported_source_entry");
    for (const path of roots) requireRelease(entries.some(entry => entry.path === path), "required_source_file_missing");
    const blobs = run(["cat-file", "--batch"], { input: entries.map(entry => entry.oid).join("\n") + "\n" });
    root = mkdtempSync(join(directory, "tabdo-release-source-"));
    const files = [];
    let offset = 0;
    for (const entry of entries) {
      const end = blobs.indexOf(10, offset);
      const [oid, type, length] = blobs.subarray(offset, end).toString().split(" ");
      const size = Number(length);
      requireRelease(oid === entry.oid && type === "blob" && Number.isSafeInteger(size) && size >= 0, "invalid_git_blob");
      const bytes = blobs.subarray(end + 1, end + 1 + size);
      requireRelease(bytes.length === size, "invalid_git_blob");
      offset = end + 1 + size + 1;
      mkdirSync(dirname(join(root, entry.path)), { recursive: true });
      writeFileSync(join(root, entry.path), bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
      files.push({ path: entry.path, mode: entry.mode, size, sha256: hash(bytes) });
    }
    const manifest = { sha, files };
    const manifestSha256 = hash(JSON.stringify(manifest));
    const verify = () => {
      const actual = [];
      const walk = path => {
        for (const name of readdirSync(join(root, path)).sort()) {
          const relative = path ? `${path}/${name}` : name;
          const stat = lstatSync(join(root, relative));
          requireRelease(!stat.isSymbolicLink(), "upload_source_changed");
          if (stat.isDirectory()) walk(relative);
          else {
            requireRelease(stat.isFile(), "upload_source_changed");
            actual.push({ path: relative, mode: stat.mode & 0o111 ? "100755" : "100644", size: stat.size, sha256: hash(readFileSync(join(root, relative))) });
          }
        }
      };
      walk("");
      const sorted = values => [...values].sort((a, b) => a.path.localeCompare(b.path));
      requireRelease(JSON.stringify(sorted(actual)) === JSON.stringify(sorted(files)), "upload_source_changed");
    };
    return { root, manifest, manifestSha256, verify, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    if (root) rmSync(root, { recursive: true, force: true });
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError("source_export_failed_details_suppressed");
  }
}

export function createUploader(env, config, source, run = execute) {
  const executable = join(env.RUNNER_TEMP, "railway-cli/node_modules/.bin/railway");
  return async (serviceId, release, onCreated = () => {}) => {
    requireRelease(config.services.includes(serviceId) && source.manifest.sha === release.sha, "upload_source_target_mismatch");
    const privateHome = mkdtempSync(join(tmpdir(), "tabdo-release-cli-"));
    const options = {
      cwd: source.root, env: { PATH: process.env.PATH, HOME: privateHome, CI: "true", RAILWAY_TOKEN: env.RAILWAY_API_TOKEN },
      timeout: 300000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    };
    try {
      source.verify();
      const version = await run(executable, ["--version"], options);
      requireRelease(version.stdout.trim() === "railway 5.71.0", "unexpected_railway_cli_version");
      const { stdout } = await run(executable, ["up", "--project", config.projectId, "--environment", config.environmentId, "--service", serviceId, "--detach", "--json", "--message", `${release.version} ${release.sha}`], options);
      // Established-project --detach --json emits this single object. Never
      // publish stdout/stderr/logsUrl: errors and URLs can contain private data.
      const value = JSON.parse(stdout);
      requireRelease(typeof value.deploymentId === "string" && /^[a-f0-9-]{36}$/.test(value.deploymentId), "deployment_id_missing_outcome_unknown");
      onCreated(value.deploymentId);
      source.verify();
      return value.deploymentId;
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      throw new ReleaseError("cli_upload_failed_outcome_unknown_details_suppressed");
    } finally { rmSync(privateHome, { recursive: true, force: true }); }
  };
}
