import * as cmds from "../commands/index.js";
import type { FullTable } from "@table/shared";

/**
 * Dry-run / mock path when no harness API key is configured.
 * Parses simple Chinese/English intents and executes the same command layer.
 */
export async function runMockAgent(opts: {
  userText: string;
  tableId?: string;
  organizationId?: string;
}): Promise<{ reply: string; mutated: boolean }> {
  const text = opts.userText.trim();
  let tableId = opts.tableId;
  let mutated = false;
  const org = { organizationId: opts.organizationId };

  if (!tableId) {
    if (!opts.organizationId) {
      return { reply: "（Mock）缺少组织上下文", mutated: false };
    }
    const tables = await cmds.listTables(org);
    tableId = tables[0]?.id;
  }
  if (!tableId) {
    return {
      reply:
        "（Mock 模式）还没有表格。请先在左侧新建，或配置 Codex/Claude/Pi 的 API Key 使用真实模型。",
      mutated: false,
    };
  }

  let table: FullTable;
  try {
    table = await cmds.getTable({ tableId, ...org });
  } catch {
    return { reply: `（Mock）找不到表格 ${tableId}`, mutated: false };
  }

  const statusCol =
    table.columns.find((c) => c.name === "状态" && c.type === "select") ||
    table.columns.find((c) => c.type === "select");
  const titleCol =
    table.columns.find((c) => c.name === "标题") ||
    table.columns.find((c) => c.type === "text");

  // list
  if (/列出|list|有哪些|看一下表|表格内容/.test(text)) {
    const lines = table.rows.map((r, i) => {
      const title = titleCol ? String(r.cells[titleCol.id] ?? "(无标题)") : r.id.slice(0, 8);
      const st =
        statusCol && statusCol.config?.options
          ? statusCol.config.options.find((o) => o.id === r.cells[statusCol.id])?.label ??
            String(r.cells[statusCol.id] ?? "—")
          : "";
      return `${i + 1}. ${title}${st ? ` [${st}]` : ""}`;
    });
    return {
      reply: `（Mock）表格「${table.name}」共 ${table.rows.length} 行：\n${lines.join("\n") || "(空)"}`,
      mutated: false,
    };
  }

  // move card: 把「xxx」移到/设为 进行中|已完成|待办|阻塞
  const moveMatch = text.match(
    /(?:把|将)?[「"']?(.+?)[」"']?(?:移到|改为|设为|改成)\s*(待办|进行中|已完成|阻塞|todo|doing|done|blocked)/i
  );
  if (moveMatch && statusCol) {
    const titleQuery = moveMatch[1].trim();
    const labelOrId = moveMatch[2].trim();
    const opt =
      statusCol.config?.options?.find(
        (o) =>
          o.label === labelOrId ||
          o.id === labelOrId.toLowerCase() ||
          o.label.includes(labelOrId)
      ) || null;
    const row = table.rows.find((r) => {
      const t = String(r.cells[titleCol?.id ?? ""] ?? "");
      return t.includes(titleQuery);
    });
    if (row && opt) {
      await cmds.setStatus({ ...org, 
        rowId: row.id,
        columnId: statusCol.id,
        statusOptionId: opt.id,
      });
      mutated = true;
      return {
        reply: `（Mock）已将「${String(row.cells[titleCol!.id])}」移到「${opt.label}」。看板/表格会自动刷新。`,
        mutated: true,
      };
    }
    return {
      reply: `（Mock）没找到匹配的行或状态。可用状态：${(statusCol.config?.options ?? [])
        .map((o) => o.label)
        .join("、")}`,
      mutated: false,
    };
  }

  // add row: 新增/添加一行 xxx
  const addMatch = text.match(/(?:新增|添加|加)(?:一行|一条|任务)?[：:\s]*[「"']?(.+?)[」"']?\s*$/);
  if (addMatch && titleCol) {
    const title = addMatch[1].trim();
    const cells: Record<string, string | null> = { [titleCol.id]: title };
    if (statusCol) {
      const todo = statusCol.config?.options?.find((o) => o.id === "todo")?.id ?? null;
      cells[statusCol.id] = todo;
    }
    await cmds.addRow({ ...org,  tableId, cells });
    mutated = true;
    return { reply: `（Mock）已新增行「${title}」。`, mutated: true };
  }

  // update person: 把xxx负责人设为yyy
  const personCol = table.columns.find((c) => c.type === "person" || c.name === "负责人");
  const personMatch = text.match(
    /(?:把|将)?[「"']?(.+?)[」"']?(?:的)?负责人(?:设为|改为|改成)\s*[「"']?(.+?)[」"']?\s*$/
  );
  if (personMatch && personCol && titleCol) {
    const row = table.rows.find((r) =>
      String(r.cells[titleCol.id] ?? "").includes(personMatch[1].trim())
    );
    if (row) {
      await cmds.updateCell({ ...org, 
        rowId: row.id,
        columnId: personCol.id,
        value: personMatch[2].trim(),
      });
      return {
        reply: `（Mock）已将「${String(row.cells[titleCol.id])}」负责人设为 ${personMatch[2].trim()}。`,
        mutated: true,
      };
    }
  }

  return {
    reply: [
      "（Mock 模式）当前没有可用的 Codex / Claude / Pi API Key，走本地规则引擎。",
      "可用示例：",
      "· 列出表格 / list",
      "· 把「乐观更新与错误回滚」移到进行中",
      "· 新增一行：支持筛选视图",
      "· 把「导出 CSV」负责人设为 Boyd",
      "",
      "配置密钥后可在聊天栏切换 harness（codex / claude / pi）与模型。",
    ].join("\n"),
    mutated,
  };
}

/** Build a minimal UI-message SSE stream compatible with AI SDK data stream protocol */
export function mockTextStream(text: string, meta?: { mutated?: boolean }) {
  const encoder = new TextEncoder();
  const id = `msg_${Date.now()}`;
  const stream = new ReadableStream({
    start(controller) {
      // AI SDK UI message stream (v5+/v7 style) — use text parts
      const write = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      write({ type: "start", messageId: id });
      write({ type: "text-start", id: "t0" });
      // chunk text
      const chunkSize = 24;
      for (let i = 0; i < text.length; i += chunkSize) {
        write({ type: "text-delta", id: "t0", delta: text.slice(i, i + chunkSize) });
      }
      write({ type: "text-end", id: "t0" });
      if (meta?.mutated) {
        write({
          type: "data-table-mutated",
          data: { mutated: true },
          transient: true,
        });
      }
      write({ type: "finish", finishReason: "stop" });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
