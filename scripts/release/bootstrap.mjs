import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "boyd4y/agrid";
const imageName = `ghcr.io/${repository}`;
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
const requireBootstrap = (condition, message) => { if (!condition) throw new Error(message); };

export function bootstrapConfig(env) {
  requireBootstrap(env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_REF === "refs/heads/master" &&
    env.GITHUB_REPOSITORY === repository && env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/ghcr-bootstrap.yml@refs/heads/master`, "bootstrap_requires_master_dispatch");
  requireBootstrap(shaPattern.test(env.BOOTSTRAP_SHA || "") && shaPattern.test(env.GITHUB_SHA || ""), "bootstrap_requires_full_commit_sha");
  requireBootstrap(env.RUNNER_TEMP, "bootstrap_requires_runner_temp");
  return { sha: env.BOOTSTRAP_SHA, workflowSha: env.GITHUB_SHA, source: join(env.RUNNER_TEMP, "ghcr-bootstrap-source"), image: `${imageName}:bootstrap-sha-${env.BOOTSTRAP_SHA}` };
}

export function verifySource(config, execute = run) {
  const git = args => execute("git", ["-C", config.source, ...args]);
  requireBootstrap(git(["rev-parse", "HEAD"]) === config.sha, "bootstrap_checkout_sha_mismatch");
  requireBootstrap(git(["status", "--porcelain", "--untracked-files=all", "--ignored"]) === "", "bootstrap_source_not_clean");
}

export function prepareSource(config, execute = run) {
  const git = args => execute("git", args);
  requireBootstrap(git(["rev-parse", "HEAD"]) === config.workflowSha, "bootstrap_workflow_sha_mismatch");
  requireBootstrap(git(["status", "--porcelain", "--untracked-files=all", "--ignored"]) === "", "bootstrap_workflow_not_clean");
  git(["fetch", "--no-tags", "origin", "+refs/heads/master:refs/remotes/origin/master"]);
  git(["merge-base", "--is-ancestor", config.workflowSha, "refs/remotes/origin/master"]);
  requireBootstrap(git(["rev-parse", `${config.sha}^{commit}`]) === config.sha, "bootstrap_input_not_commit");
  git(["merge-base", "--is-ancestor", config.sha, "refs/remotes/origin/master"]);
  // A separate worktree keeps the trusted master guards out of the build context
  // and supports bootstrapping commits that predate this workflow.
  git(["worktree", "add", "--detach", config.source, config.sha]);
  verifySource(config, execute);
}

export async function requireAbsentTag(config, env, request = fetch) {
  requireBootstrap(env.PACKAGE_TOKEN && env.GITHUB_ACTOR, "bootstrap_package_credentials_missing");
  const get = (url, headers) => request(url, { headers, redirect: "error", signal: AbortSignal.timeout(30000) });
  const auth = await get(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull,push`, {
    Authorization: `Basic ${Buffer.from(`${env.GITHUB_ACTOR}:${env.PACKAGE_TOKEN}`).toString("base64")}`,
  });
  requireBootstrap(auth.status === 200, "bootstrap_registry_auth_failed");
  const { token } = await auth.json();
  requireBootstrap(typeof token === "string" && token.length > 0, "bootstrap_registry_token_missing");
  const response = await get(`https://ghcr.io/v2/${repository}/manifests/bootstrap-sha-${config.sha}`, {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
  });
  requireBootstrap(response.status !== 200, "bootstrap_tag_already_exists_refusing_overwrite");
  requireBootstrap(response.status === 404, "bootstrap_registry_absence_not_confirmed");
  const { errors } = await response.json();
  requireBootstrap(Array.isArray(errors) && errors.length > 0 && errors.every(error => ["MANIFEST_UNKNOWN", "NAME_UNKNOWN"].includes(error.code)), "bootstrap_registry_absence_not_confirmed");
}

export function pushedDigest(config, execute = run) {
  const [image] = JSON.parse(execute("docker", ["image", "inspect", config.image]));
  requireBootstrap(image?.Os === "linux" && image?.Architecture === "amd64" &&
    image?.Config?.Labels?.["org.opencontainers.image.revision"] === config.sha &&
    image?.Config?.Labels?.["org.opencontainers.image.source"] === `https://github.com/${repository}`, "bootstrap_image_identity_mismatch");
  const digests = image.RepoDigests?.filter(value => value.startsWith(`${imageName}@`)) || [];
  requireBootstrap(digests.length === 1 && digestPattern.test(digests[0].slice(imageName.length + 1)), "bootstrap_pushed_digest_missing");
  return digests[0].slice(imageName.length + 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = bootstrapConfig(process.env);
    const output = values => appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
    switch (process.argv[2]) {
      case "prepare": prepareSource(config); output({ source: config.source, image: config.image }); break;
      case "check": verifySource(config); await requireAbsentTag(config, process.env); break;
      case "result": {
        const digest = pushedDigest(config);
        output({ digest });
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Bootstrap image: \`${config.image}\`\n\nDigest: \`${imageName}@${digest}\`\n\nVerify anonymous pull separately after making the package public.\n`);
        console.log(`${imageName}@${digest}`);
        break;
      }
      default: throw new Error("bootstrap_unknown_command");
    }
  } catch (error) {
    // Never print raw Git, registry or Docker errors that could contain credentials.
    console.error(/^bootstrap_[a-z_]+$/.test(error.message) ? error.message : "bootstrap_failed");
    process.exitCode = 1;
  }
}
