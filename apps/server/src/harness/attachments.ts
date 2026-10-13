import { VERSION as piVersion } from "@ai-sdk/harness-pi";
import { VERSION as codexVersion } from "@ai-sdk/harness-codex";
import { VERSION as claudeVersion } from "@ai-sdk/harness-claude-code";
import { HTTPException } from "hono/http-exception";
import type { HarnessId } from "../ai/model.js";

export type HarnessAttachmentSupport = {
  harness: HarnessId;
  adapter: string;
  adapterVersion: string;
  supportsImages: boolean;
  supportsFiles: boolean;
  reason: string;
};
const adapters: Record<HarnessId, { name: string; version: string }> = {
  pi: { name: "@ai-sdk/harness-pi", version: piVersion },
  codex: { name: "@ai-sdk/harness-codex", version: codexVersion },
  claude: { name: "@ai-sdk/harness-claude-code", version: claudeVersion },
};

/**
 * HarnessV1 intentionally has no static attachment capabilities. All installed
 * adapters' extractUserText implementations reject ImagePart/FilePart with
 * HarnessCapabilityUnsupportedError; this describes that concrete limitation.
 * Recheck adapters and the native fixture when upgrading, rather than inferring
 * support from UserModelMessage's wider type or a model's vision capability.
 */
export function getHarnessAttachmentSupport(harness: HarnessId): HarnessAttachmentSupport {
  const adapter = adapters[harness];
  return {
    harness, adapter: adapter.name, adapterVersion: adapter.version,
    supportsImages: false, supportsFiles: false,
    reason: `${adapter.name} ${adapter.version} 当前只支持文字消息，暂不支持图片或文件附件。`,
  };
}

/** Preflight ONLY the current user's parts, before creating a run or native session. */
export function prepareHarnessUserPrompt(input: { harness: HarnessId; parts: readonly unknown[] }): string {
  const support = getHarnessAttachmentSupport(input.harness);
  const text: string[] = [];
  for (const part of input.parts) {
    if (!part || typeof part !== "object" || !("type" in part))
      throw new HTTPException(400, { message: "消息内容格式无效" });
    if (part.type === "file" || part.type === "image") {
      // Never fetch URLs, decode data, read paths, or silently strip attachments.
      throw new HTTPException(400, { message: support.reason });
    }
    if (part.type !== "text") throw new HTTPException(400, { message: "当前 Harness 只支持文字消息内容" });
    if (!("text" in part) || typeof part.text !== "string")
      throw new HTTPException(400, { message: "文字消息格式无效" });
    text.push(part.text);
  }
  const prompt = text.join("\n\n");
  if (!prompt.trim()) throw new HTTPException(400, { message: "请输入要执行的任务" });
  return prompt;
}
