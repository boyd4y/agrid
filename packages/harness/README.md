# @tabdo/harness

Provider-neutral assembly around the official AI SDK HarnessAgent. Default exports are contracts, configuration errors and sandbox compatibility checks; adapters and the agent factory are separate subpaths.

- `adapters/pi`: explicit OpenAI-compatible provider/model settings, native completion observation and official continuation input hooks.
- `adapters/codex` / `adapters/claude-code`: explicit native credentials, model selection and network-sandbox requirements.
- `agent`: construct the official HarnessAgent and register its SDK-provided client question tool when appropriate. Native loops, history, tools and skills remain owned by the SDK.

```ts
import { createPiAdapter } from "@tabdo/harness/adapters/pi";
import { createHarnessAgent } from "@tabdo/harness/agent";
const adapter = createPiAdapter({ providerId: "my-provider", apiKey, baseUrl,
  model: { id: modelId, contextWindow: 65536, maxTokens: 4096, reasoning: false },
  maxTokensField: "max_tokens" });
const agent = createHarnessAgent(adapter, { instructions, tools, skills });
```

No environment lookup, Tabdo persona, HTTP errors, organization/schema access, product prompt, workspace path or persistence policy exists here. Applications supply settings and callbacks; SDK packages are pinned peers, with provider-specific peers optional. Importing the default entry does not load Pi/Codex/Claude runtimes.

Pi retains its official `reattachInProcess: true` default. A real producer-exit/consumer-process test confirms persisted pending-question continuation without replay. With pinned Pi 1.0.151, setting this option false changes pending question capture to a suspension error; it is not a shortcut to stateless deployment. Platforms still must manage checkpoint and environment lifecycle explicitly.

`pnpm --filter @tabdo/harness test` runs a real native Pi loop against a local HTTP protocol fixture, host-tool execution, native history resume and compatibility checks. No product DB, actual provider credentials or remote model calls are needed. Complete Tabdo lifecycle tests remain in `apps/server/test/harness/`.
