import type { GatewayCredentials, GatewayAction, GatewayActions } from "@tabdo/backend/agent/gateway-contracts";
export type { GatewayCredentials, GatewayToolDefinition, GatewayPreparedAgent, GatewayBootstrap, GatewayActions, GatewayAction } from "@tabdo/backend/agent/gateway-contracts";

export class GatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message);this.name = "GatewayError"; }
}

/** No automatic network retries: a lost response never proves no effect occurred. */
export function createExecutionGatewayClient(options: GatewayCredentials & { gatewayUrl: string; fetch?: typeof fetch }) {
  const call = async <Action extends GatewayAction>(action: Action, payload: GatewayActions[Action]["input"]): Promise<GatewayActions[Action]["output"]> => {
    const response = await (options.fetch ?? fetch)(options.gatewayUrl, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${options.token}`, "x-tabdo-launch-token": options.launchToken },
      body: JSON.stringify({ action, payload }),
      signal: AbortSignal.timeout(action === "bootstrap" ? 30_000 : 15_000),
    });
    const limit = action === "bootstrap" ? 48 * 1024 * 1024 : 2 * 1024 * 1024;
    const reader = response.body?.getReader();
    if (!reader) throw new GatewayError(502, "Execution gateway returned an empty response");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) { await reader.cancel();throw new GatewayError(502, "Execution gateway response exceeded its limit"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as GatewayActions[Action]["output"] & { error?: string };
    if (!response.ok) throw new GatewayError(response.status, value.error ?? "Execution gateway request failed");
    return value;
  };
  return { call };
}
