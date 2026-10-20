import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { requireRelease, releaseEvent, ReleaseError } from "./guards.mjs";

export function verifyGit(release, run = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim(), { allowPeeledEvent = false } = {}) {
  try {
    const tagRef = `refs/tags/${release.version}`;
    const refs = new Map(run(["ls-remote", "origin", tagRef, `${tagRef}^{}`]).split("\n").filter(Boolean).map(line => {
      const [oid, ref] = line.split(/\s+/); return [ref, oid];
    }));
    const tagOid = refs.get(tagRef);
    const peeled = refs.get(`${tagRef}^{}`) || tagOid;
    // Push payloads can identify an annotated tag by its peeled commit. Capture
    // the raw object at authorization; all production checks require that pin.
    requireRelease(peeled === release.sha && (tagOid === release.tagOid || (allowPeeledEvent && release.tagOid === release.sha)), "tag_rebound_or_sha_mismatch");
    requireRelease(run(["rev-parse", "HEAD"]) === release.sha, "checkout_sha_mismatch");
    run(["fetch", "--no-tags", "origin", "+refs/heads/master:refs/remotes/origin/master"]);
    run(["merge-base", "--is-ancestor", release.sha, "refs/remotes/origin/master"]);
    return tagOid;
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError("commit_not_on_master_or_git_verification_failed");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = releaseEvent(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), process.env);
    release.tagOid = verifyGit(release, undefined, { allowPeeledEvent: true });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(""));
    console.log(JSON.stringify(release));
  } catch (error) { console.error(error instanceof ReleaseError ? error.code : "release_git_validation_failed"); process.exitCode = 1; }
}
