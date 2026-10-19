import { tool, zodSchema, type ToolSet } from "ai";
import { MEMORY_LIST_SCHEMA, MEMORY_READ_SCHEMA, MEMORY_WRITE_SCHEMA, MEMORY_FORGET_SCHEMA } from "@tabdo/shared";
import type { DatabaseDependencies } from "../../dependencies.js";
import type { Transaction } from "../../db/types.js";
import { listAgentMemory, readAgentMemory, writeAgentMemory, forgetAgentMemory, type AgentMemoryScope } from "../memory.js";

export function createMemoryTools(dependencies: () => DatabaseDependencies & { uuid(): string }, scope: AgentMemoryScope, transaction: () => Transaction | undefined = () => undefined): ToolSet {
  return {
    memory_list: tool({ description: "查看当前智能体与当前用户的 MEMORY.md 索引和 revision，不加载主题正文。", inputSchema: zodSchema(MEMORY_LIST_SCHEMA), execute: () => listAgentMemory(dependencies(), scope, transaction()) }),
    memory_read: tool({ description: "按需读取记忆主题 Markdown 正文和当前 revision；主题名来自索引。", inputSchema: zodSchema(MEMORY_READ_SCHEMA), execute: input => readAgentMemory(dependencies(), scope, input, transaction()) }),
    memory_write: tool({ description: "立即持久保存跨对话有用的偏好、纠正、项目约束或参考。新建 expectedRevision=null，需 name/description/type；更新先读 revision，省略元数据保留原值。同一主题复用文件名。冲突后重新读取，不盲目覆盖。不要保存秘密或临时日志。", inputSchema: zodSchema(MEMORY_WRITE_SCHEMA), execute: input => writeAgentMemory(dependencies(), scope, input, transaction()) }),
    memory_forget: tool({ description: "立即永久遗忘一个主题，需先读取当前 revision。删除后不能用旧 revision 恢复。", inputSchema: zodSchema(MEMORY_FORGET_SCHEMA), execute: input => forgetAgentMemory(dependencies(), scope, input, transaction()) }),
  };
}
