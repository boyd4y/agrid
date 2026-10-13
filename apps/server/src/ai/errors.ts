import { InvalidToolInputError, NoSuchToolError, type TextStreamPart, type ToolSet } from "ai";
import { ZodError } from "zod";

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  while (error != null && !chain.includes(error) && chain.length < 8) {
    chain.push(error);
    error = typeof error === "object" && "cause" in error ? error.cause : undefined;
  }
  return chain;
}

function validationDetails(error: ZodError): string {
  const types: Record<string, string> = { string: "字符串", number: "数字", boolean: "布尔值", array: "数组", object: "对象" };
  return error.issues.slice(0, 8).map((issue) => {
    const field = issue.path.join(".") || "参数";
    if (issue.code === "invalid_format" && issue.format === "uuid") {
      return `${field}：必须是 UUID ID，不能使用字段名称`;
    }
    if (issue.code === "invalid_type") {
      const required = issue.message.includes("undefined") ? "缺少必填参数；" : "";
      return `${field}：${required}需要${types[issue.expected] ?? issue.expected}`;
    }
    if (issue.code === "unrecognized_keys") {
      return `${field}：不支持这些参数：${issue.keys.join("、")}`;
    }
    return `${field}：${issue.message}`;
  }).join("；");
}

/** Expose actionable errors without serializing SQL, raw inputs, stacks or credentials. */
export function chatErrorText(error: unknown): string {
  const chain = errorChain(error);
  const invalid = chain.find(InvalidToolInputError.isInstance);
  const validation = chain.find((cause): cause is ZodError => cause instanceof ZodError);
  if (invalid) {
    const detail = validation
      ? validationDetails(validation)
      : "参数不是符合工具定义的 JSON，请检查必填参数、类型和格式";
    const relationHint = ["add_relation", "set_relation", "remove_relation"].includes(invalid.toolName)
      ? "。创建关联字段请使用 add_column（type=relation，relation 配置目标表及反向字段）；此工具只操作已有字段的记录关联，需传 rowId、columnId 和 recordIds，均使用实际 ID。先用 get_table / query_rows 获取 ID"
      : "";
    return `工具 ${invalid.toolName} 参数错误：${detail}${relationHint}`;
  }
  const missing = chain.find(NoSuchToolError.isInstance);
  if (missing) {
    return `工具 ${missing.toolName} 不存在。请使用已提供的工具${missing.availableTools?.length ? `：${missing.availableTools.join("、")}` : ""}`;
  }
  if (validation) return `参数错误：${validationDetails(validation)}`;

  const database = chain.find((cause) => typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string" && /^\d{2}[\dA-Z]{3}$/.test(cause.code)) as { code: string } | undefined;
  if (database) {
    const reasons: Record<string, string> = {
      "23505": "数据冲突：重复记录或单条关联限制，请先查询现有数据",
      "23503": "关联依赖不存在或仍被引用，请核对记录和字段",
      "23514": "数据不符合约束，请核对关联归属及字段限制",
      "23502": "缺少数据库必填字段，请核对输入",
      "40001": "并发更新冲突，请重新读取最新数据后重试",
      "40P01": "并发操作冲突，请重新读取最新数据后重试",
    };
    return reasons[database.code] ?? `数据库操作失败（${database.code}），请稍后重试`;
  }
  if (chain.some((cause) => cause instanceof Error && /^(Failed query:|Failed to execute query:)/.test(cause.message))) {
    return "数据库操作失败，请稍后重试";
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "请求失败，服务端未提供错误详情";
  return message
    .replace(/\b(postgres(?:ql)?|https?|redis):\/\/[^\s/@]+:[^\s/@]+@/gi, "$1://[redacted]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

/** Invalid calls can emit a later serialized tool-error; keep one reason per call. */
export function normalizeChatToolErrors() {
  const errors = new Map<string, string>();
  return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
    transform(part, controller) {
      if (part.type === "tool-call" && part.invalid) {
        const error = chatErrorText(part.error);
        errors.set(part.toolCallId, error);
        controller.enqueue({ ...part, error });
      } else if (part.type === "tool-error") {
        const error = errors.get(part.toolCallId) ?? chatErrorText(part.error);
        controller.enqueue({ ...part, error });
        errors.delete(part.toolCallId);
      } else {
        controller.enqueue(part);
      }
    },
  });
}
