import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export type PiModelMetadata = { contextWindow: number; maxTokens: number; reasoning: boolean };
export const DEFAULT_PI_OUTPUT_TOKENS = 16384;
export type PiCompletion = { finishReason: string; outputTokens: number; reasoningTokens: number };
const catalog = z.object({ data: z.array(z.object({ id: z.string(), context_length: z.number().int().positive(),
  top_provider: z.object({ max_completion_tokens: z.number().int().positive().nullable().optional() }).nullable().optional(),
  supported_parameters: z.array(z.string()).optional(),
})) });
const cache = new Map<string, { expires: number; value: PiModelMetadata }>();

function configuredLimit(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  if (!env[name]) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 4_000_000) throw new HTTPException(503, { message: `${name} 必须是正整数 token 上限` });
  return value;
}

/** Pi must receive real model limits: an invented 32k window clamps long prompts to one token. */
export async function resolvePiModelMetadata(modelId: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<PiModelMetadata> {
  if (!env.OPENROUTER_API_KEY?.trim()) return {
    contextWindow: configuredLimit(env, "PI_CONTEXT_WINDOW", 32768),
    maxTokens: configuredLimit(env, "PI_MAX_OUTPUT_TOKENS", DEFAULT_PI_OUTPUT_TOKENS), reasoning: false,
  };
  const id = modelId?.trim() || env.PI_MODEL?.trim() || env.OPENROUTER_MODEL?.trim() || "openrouter/free";
  const base = (env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const outputLimit = configuredLimit(env, "PI_MAX_OUTPUT_TOKENS", DEFAULT_PI_OUTPUT_TOKENS);
  const key = `${base}:${id}:${outputLimit}`, saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  try {
    const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`模型目录返回 HTTP ${response.status}`);
    const models = catalog.parse(await response.json());
    const model = models.data.find((model) => model.id === id);
    if (!model) throw new HTTPException(400, { message: `模型目录中没有 ${id}，请检查智能体的模型配置` });
    const value: PiModelMetadata = {
      contextWindow: model.context_length,
      maxTokens: Math.min(outputLimit, model.top_provider?.max_completion_tokens ?? outputLimit),
      // Dynamic routers cannot promise one reasoning model across calls.
      reasoning: !id.startsWith("openrouter/") && Boolean(model.supported_parameters?.some((parameter) => parameter === "reasoning" || parameter === "reasoning_effort")),
    };
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 300_000 });
    return value;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, { message: "无法读取模型上下文与输出上限，请稍后重试", cause: error });
  }
}
