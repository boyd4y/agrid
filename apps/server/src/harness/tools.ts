import { asSchema, jsonSchema, InvalidToolInputError, type ToolSet, type TextStreamPart } from "ai";
import { chatErrorText } from "../ai/errors.js";

/** SDK filtering uses a result payload for denied calls, rather than throwing. */
export function nativeToolDenial(output: unknown): string | undefined {
  if (output && typeof output === "object" && "type" in output && output.type === "execution-denied") {
    return "reason" in output && typeof output.reason === "string" ? output.reason : "工具已关闭，无法执行";
  }
  return undefined;
}

/**
 * Harness 1.0.149 discards host input validation causes. Keep the model's JSON
 * schema unchanged, but validate with the original schema before host execution.
 * Native built-in tools and the SDK-owned execution loop are unchanged.
 */
export function nativeHostTools(
  definitions: ToolSet,
  guard: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  const failures = new Map<string, string>();
  const tools: ToolSet = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
    if (!definition.execute) return [name, definition];
    const schema = asSchema(definition.inputSchema);
    if (!schema.validate) throw new Error(`工具 ${name} 缺少输入校验器`);
    return [name, {
      ...definition,
      inputSchema: jsonSchema(() => schema.jsonSchema),
      execute: async (input: unknown, execution: Parameters<NonNullable<typeof definition.execute>>[1]) => {
        try {
          const parsed = await schema.validate!(input);
          if (!parsed.success) throw new InvalidToolInputError({ toolName: name, toolInput: "[redacted]", cause: parsed.error });
          const output = await guard(async () => definition.execute!(parsed.value, execution));
          // SDK work-dir projection treats non-JSON objects such as Date as {}.
          // Business tools cross a JSON boundary; canonicalize before projection.
          return output === undefined ? null : JSON.parse(JSON.stringify(output));
        } catch (error) {
          const reason = chatErrorText(error);
          failures.set(execution.toolCallId, reason);
          throw new Error(reason, { cause: error });
        }
      },
    }];
  }));
  const projectErrors = () => new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
    transform(part, controller) {
      if (part.type === "tool-result") {
        const denial = nativeToolDenial(part.output);
        if (denial) failures.set(part.toolCallId, denial);
      }
      // Pi may publish the failed host submission as a tool-result. The official
      // host execution exception is authoritative; preserve it in UI history.
      if ((part.type === "tool-result" || part.type === "tool-error") && failures.has(part.toolCallId)) {
        const error = failures.get(part.toolCallId)!;
        controller.enqueue({ type: "tool-error", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, error });
      } else controller.enqueue(part);
    },
  });
  return { tools, projectErrors, failures };
}
