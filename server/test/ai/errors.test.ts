import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidToolInputError, NoSuchToolError, TypeValidationError } from "ai";
import { z } from "zod";
import { chatErrorText } from "../../src/ai/errors.js";

test("nested SDK validation errors name each field and explain how to correct a relation call", () => {
  const input = { columnId: "所属客户", targetTableId: "private-input-must-not-be-echoed" };
  const parsed = z.strictObject({ columnId: z.string().uuid(), recordIds: z.array(z.string().uuid()) }).safeParse(input);
  assert(!parsed.success);
  const cause = new TypeValidationError({ value: input, cause: parsed.error });
  const error = new InvalidToolInputError({ toolName: "add_relation", toolInput: JSON.stringify(input), cause });
  const text = chatErrorText(error);
  assert.match(text, /add_relation 参数错误/);
  assert.match(text, /columnId：必须是 UUID/);
  assert.match(text, /recordIds：缺少必填参数/);
  assert.match(text, /不支持这些参数：targetTableId/);
  assert.match(text, /创建关联字段请使用 add_column/);
  assert(!text.includes("private-input-must-not-be-echoed"));
});

test("unavailable tools and malformed JSON provide a correction instead of a generic error", () => {
  assert.match(chatErrorText(new NoSuchToolError({ toolName: "create_relation", availableTools: ["add_column", "add_relation"] })), /create_relation 不存在[\s\S]*add_column/);
  assert.match(chatErrorText(new InvalidToolInputError({ toolName: "get_table", toolInput: "{", cause: new SyntaxError("invalid JSON") })), /get_table 参数错误[\s\S]*JSON/);
});

test("business errors retain the reason and redact credentials", () => {
  assert.equal(chatErrorText(new Error("关联记录不存在或不属于目标表格")), "关联记录不存在或不属于目标表格");
  const text = chatErrorText(new Error("connect postgresql://user:secret@db/test Authorization Bearer private-token"));
  assert(!text.includes("secret")); assert(!text.includes("private-token"));
});

test("database errors preserve actionable constraint reasons without exposing queries", () => {
  const cause = Object.assign(new Error("duplicate key with private values"), { code: "23505" });
  const error = new Error("Failed query: INSERT INTO rows private SQL", { cause });
  assert.match(chatErrorText(error), /数据冲突[\s\S]*单条关联/);
  assert(!chatErrorText(error).includes("private"));
  assert.match(chatErrorText(new Error("Failed query: private SQL")), /数据库操作失败/);
});
