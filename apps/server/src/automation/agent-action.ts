import { runAutomationAgentAction as run, type ActionInput } from "../business/automation/agent-action.js";
import { runtimeDependencies } from "../services/dependencies.js";
import { prepareNativeChatAgent } from "../harness/preparation.js";
import { executeAcceptedNativeRun } from "../runner/execute.js";
import { chatErrorText } from "../ai/errors.js";
export type { AutomationAgentActionResult } from "../business/automation/agent-action.js";
export function runAutomationAgentAction(input: ActionInput) {
  return run({ ...runtimeDependencies(),agent: {
    async prepare(options) {
      const prepared = await prepareNativeChatAgent(options);
      return { ...prepared,tableId: options.boundTableId ?? options.context.context.tableId ?? undefined };
    },
    async dispatch(reference) { await executeAcceptedNativeRun(reference.executionId); },
    formatError: chatErrorText,
  } },input);
}
