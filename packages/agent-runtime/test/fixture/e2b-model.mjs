// Deterministic HTTP model only. All execution remains in the official CLI.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

let calls = 0;
const requests = [];
const command = "printf 'committed\\n' >> bridge-count; printf 'bridge-remote-tool-result'";
const reply = "E2B bridge complete.";
const server = createServer(async (request, response) => {
  if (request.url === "/health") { response.end("ready"); return; }
  let raw = ""; for await (const part of request) raw += part;
  const body = JSON.parse(raw || "{}");
  if (request.url?.includes("count_tokens")) { response.setHeader("content-type", "application/json"); response.end('{"input_tokens":100}'); return; }
  requests.push({ path: request.url, body });
  writeFileSync("bridge-requests.json", JSON.stringify(requests));
  calls++;
  const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  response.setHeader("content-type", "text/event-stream");
  if (request.url?.includes("responses")) {
    const names = (body.tools ?? []).map(tool => tool.name);
    const name = ["exec_command", "shell_command", "shell"].find(name => names.includes(name));
    if (!name && calls === 1) { response.statusCode = 400; response.end(JSON.stringify({ error: { message: `No shell fixture tool: ${names.join(",")}` } })); return; }
    const input = name === "exec_command" ? { cmd: command, yield_time_ms: 1000 } : name === "shell_command" ? { command } : { command: ["bash", "-lc", command] };
    const output = calls === 1 ? { type: "function_call", id: "fc_e2b", call_id: "call_e2b", name, arguments: JSON.stringify(input), status: "completed" }
      : { type: "message", id: `msg_${calls}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: reply, annotations: [] }] };
    const result = { id: `resp_${calls}`, object: "response", created_at: 1, status: "in_progress", model: body.model, output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    send("response.created", { response: result });
    send("response.output_item.added", { output_index: 0, item: { ...output, ...(calls === 1 ? { arguments: "" } : { content: [] }) } });
    if (calls === 1) {
      send("response.function_call_arguments.delta", { item_id: output.id, output_index: 0, delta: output.arguments });
      send("response.function_call_arguments.done", { item_id: output.id, output_index: 0, arguments: output.arguments });
    } else {
      send("response.content_part.added", { item_id: output.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      send("response.output_text.delta", { item_id: output.id, output_index: 0, content_index: 0, delta: reply });
      send("response.output_text.done", { item_id: output.id, output_index: 0, content_index: 0, text: reply });
      send("response.content_part.done", { item_id: output.id, output_index: 0, content_index: 0, part: output.content[0] });
    }
    send("response.output_item.done", { output_index: 0, item: output });
    send("response.completed", { response: { ...result, status: "completed", output: [output] } });
  } else if (request.url?.includes("messages")) {
    const tool = calls === 1;
    const block = tool ? { type: "tool_use", id: "toolu_e2b", name: "Bash", input: { command, description: "E2B remote proof" } } : { type: "text", text: reply };
    const message = { id: `msg_${calls}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } };
    if (!body.stream) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ...message, content: [block], stop_reason: tool ? "tool_use" : "end_turn" })); return; }
    send("message_start", { message });
    send("content_block_start", { index: 0, content_block: tool ? { ...block, input: {} } : { type: "text", text: "" } });
    send("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) } : { type: "text_delta", text: reply } });
    send("content_block_stop", { index: 0 });
    send("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
    send("message_stop", {});
  } else {
    response.statusCode = 404; response.end(JSON.stringify({ error: { message: "Unknown model fixture route" } })); return;
  }
  response.end();
});
server.listen(4010, "0.0.0.0");
