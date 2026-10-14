import { DurableObject } from "cloudflare:workers";
import { ServiceError } from "@tabdo/backend/errors";
import type { QuestionPair,ValidatedQuestionPair } from "./chat.js";

export type ValidationProgram = Readonly<{ imageKey: string; entrypoint: readonly string[]; command: readonly string[] }>;

async function boundedOutput(stream: ReadableStream<Uint8Array> | null,limit: number): Promise<string> {
  if (!stream) throw new Error("Validator output is absent");
  const reader = stream.getReader(),decoder = new TextDecoder();let size = 0,text = "";
  try {
    for (;;) {
      const { done,value } = await reader.read();if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {});throw new Error("Validator output exceeds bounds"); }
      text += decoder.decode(value,{ stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Dedicated short-lived validator, never an execution container or native conversation. */
export type ValidationObjectClass<Env> = new (ctx: DurableObjectState,env: Env) => DurableObject<Env> & { validateQuestions(pairs: readonly QuestionPair[]): Promise<readonly ValidatedQuestionPair[]> };
export function createProductValidationObject<Env>(configure: (env: Env) => ValidationProgram): ValidationObjectClass<Env> {
  return class ProductValidationObject extends DurableObject<Env> {
    #claimed = false;
    async validateQuestions(pairs: readonly QuestionPair[]): Promise<readonly ValidatedQuestionPair[]> {
      if (this.#claimed || this.ctx.container?.running) throw new ServiceError(409,{ message: "问题校验实例已经使用" });
      this.#claimed = true;
      if (!Array.isArray(pairs) || !pairs.length || pairs.length > 50) throw new ServiceError(400,{ message: "问题校验内容无效" });
      const bytes = new TextEncoder().encode(JSON.stringify({ pairs }));
      if (bytes.byteLength > 131072) throw new ServiceError(413,{ message: "问题校验内容过大" });
      const program = configure(this.env),container = this.ctx.container;
      if (!container || !program.entrypoint.length || !program.command.length) throw new ServiceError(503,{ message: "原生问题校验服务未配置" });
      const image = container.images[program.imageKey];
      if (!image) throw new ServiceError(503,{ message: "原生问题校验环境不可用" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = new AbortController();
      try {
        container.start({ image,enableInternet: false,entrypoint: [...program.entrypoint] });
        await container.setInactivityTimeout(60000);
        timer = setTimeout(() => abort.abort(),15000);
        const stdin = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes);controller.close(); } });
        const process = await container.exec([...program.command],{ stdin,stdout: "pipe",stderr: "ignore",signal: abort.signal });
        const [text,code] = await Promise.all([boundedOutput(process.stdout,131072),process.exitCode.then(code => { if (timer !== undefined) clearTimeout(timer);timer = undefined;return code; })]);
        if (code !== 0) throw new ServiceError(400,{ message: "提问或回答格式无效" });
        const result = JSON.parse(text) as { pairs?: unknown };
        if (!Array.isArray(result.pairs) || result.pairs.length !== pairs.length) throw new Error("Incomplete official validator response");
        // JSON comes only from the fixed official-SDK validation entry after a zero exit.
        return result.pairs as ValidatedQuestionPair[];
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(503,{ message: "原生问题校验服务暂不可用" });
      } finally { if (timer !== undefined) clearTimeout(timer);await container.destroy(); }
    }
  };
}
