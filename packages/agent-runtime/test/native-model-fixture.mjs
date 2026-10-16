import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/** HTTP model protocol only; native execution remains in the official Harness. */
export function createNativeModelFixture(selected, toolName = "receipt", toolInput = {}) {
  let requests = 0, turn = 0, toolIssued = false;
  let heldResponse;
  const bodies = [], errors = [];
  const firstReply = `First receipt saved ${randomUUID()}`, secondReply = "Receipt remembered without replay";
  const model = createServer(async (request, response) => {
    try {
      let raw = "";for await (const chunk of request) raw += chunk;
      if (request.method !== "POST" || !request.url?.includes(selected === "claude" ? "/messages" : selected === "pi" ? "/chat/completions" : "/responses")) {
        response.setHeader("content-type", "application/json");response.end("{}");return;
      }
      const body = JSON.parse(raw);bodies.push(body);
      if (request.url?.includes("count_tokens")) { response.end(JSON.stringify({ input_tokens: 100 }));return; }
      requests++;
      if (heldResponse && body.stream !== false) {
        response.writeHead(200, { "content-type": "text/event-stream" });response.write(": waiting for cancellation\n\n");
        heldResponse();heldResponse = undefined;return;
      }
      const tools = body.tools ?? [];
      const receipt = tools.find((entry) => (entry.name ?? entry.function?.name)?.includes(toolName));
      const call = turn === 0 && !toolIssued && Boolean(receipt);
      if (call) toolIssued = true;
      if (call) assert(receipt, `host receipt tool missing: ${JSON.stringify(tools.map((entry) => entry.name))}`);
      if (selected === "claude" && body.stream === false) {
        response.setHeader("content-type", "application/json");response.end(JSON.stringify({ id: `msg_${requests}`, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "fixture auxiliary reply" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } }));return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      const text = turn === 0 ? firstReply : secondReply;
      if (selected === "pi") {
        const sendChunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: `fixture-${requests}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        sendChunk({ role: "assistant" });
        if (call) {
          sendChunk({ tool_calls: [{ index: 0, id: "call_receipt", type: "function", function: { name: receipt.function.name, arguments: JSON.stringify(toolInput) } }] });
          sendChunk({}, "tool_calls");
        } else { sendChunk({ content: text });sendChunk({}, "stop"); }
        response.write("data: [DONE]\n\n");
      } else if (selected === "claude") {
        send("message_start", { message: { id: `msg_${requests}`, type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
        send("content_block_start", { index: 0, content_block: call ? { type: "tool_use", id: "toolu_receipt", name: receipt.name, input: {} } : { type: "text", text: "" } });
        send("content_block_delta", { index: 0, delta: call ? { type: "input_json_delta", partial_json: JSON.stringify(toolInput) } : { type: "text_delta", text } });
        send("content_block_stop", { index: 0 });
        send("message_delta", { delta: { stop_reason: call ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
        send("message_stop", {});
      } else {
        const id = `resp_${requests}`;
        const item = call ? { type: "function_call", id: "fc_receipt", call_id: "call_receipt", name: receipt.name, arguments: JSON.stringify(toolInput), status: "completed" }
          : { type: "message", id: `msg_${requests}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
        send("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
        send("response.output_item.added", { output_index: 0, item: { ...item, ...(call ? { arguments: "" } : { content: [] }), status: "in_progress" } });
        if (call) send("response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: JSON.stringify(toolInput) });
        else {
          send("response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
          send("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: text });
          send("response.output_text.done", { item_id: item.id, output_index: 0, content_index: 0, text });
          send("response.content_part.done", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text, annotations: [] } });
        }
        if (call) send("response.function_call_arguments.done", { item_id: item.id, output_index: 0, arguments: JSON.stringify(toolInput) });
        send("response.output_item.done", { output_index: 0, item });
        send("response.completed", { response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } });
      }
      response.end();
    } catch (error) { errors.push(String(error));response.writeHead(500);response.end(); }
  });

  return { model, bodies, errors, firstReply, secondReply, nextTurn: () => { turn++; },
    holdNextResponse: () => new Promise(resolve => { heldResponse = resolve; }), get requests() { return requests; } };
}
