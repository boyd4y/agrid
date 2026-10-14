import type { ExecutionAdapter } from "@tabdo/execution";
import type { UIMessageChunk } from "ai";
import type { ChatContext } from "../chat/context.js";
import { and, eq, inArray, asc } from "drizzle-orm";
import { getDatabase, requirePlatformResources, withPlatformResources } from "@tabdo/platform/resources";
import { agentExecutions, agentRuns } from "../db/schema.js";
import { resolveActor } from "../auth/actor.js";
import { acceptNativeExecution, readNativeExecutionOutput } from "../runner/repository.js";
import { releaseRuntimeLease } from "./store.js";
import { registerNativeRun } from "./drain.js";
import type { NativeRunInput } from "./execution.js";

async function launch(execution: ExecutionAdapter, reference: { executionId: string; runId: string; threadId: string }) {
  const release = registerNativeRun();
  try {
    const handle = await execution.start({ id: reference.executionId, reference: { executionId: reference.executionId } });
    void handle.completion.then(release, release);
  } catch (error) { release();throw error; }
}

/** Node's wake-up loop uses the same private receipts after admission/host failure. */
export async function dispatchAcceptedNativeExecutions(execution: ExecutionAdapter, limit = 8) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new TypeError("Invalid dispatch batch size");
  const references = await getDatabase().select({ executionId: agentExecutions.id, runId: agentRuns.id, threadId: agentRuns.threadId })
    .from(agentExecutions).innerJoin(agentRuns, eq(agentRuns.id, agentExecutions.runId))
    .where(and(eq(agentExecutions.status, "accepted"), inArray(agentRuns.status, ["starting", "running"])))
    .orderBy(asc(agentExecutions.acceptedAt)).limit(limit);
  return Promise.allSettled(references.map(reference => launch(execution, reference)));
}

/** The public chat protocol is independent of the computing adapter. */
export type NativeRunStreamFactory = (input: NativeRunInput, delivery: {
  context: ChatContext; request: Request;
}) => Promise<ReadableStream<UIMessageChunk>>;

/** Persist acceptance first, then launch a trusted process with only its private reference. */
export function createDispatchedNativeStream(execution: ExecutionAdapter): NativeRunStreamFactory {
  return async (input, delivery) => {
    const reference = await acceptNativeExecution({ actor: input.actor, lease: input.lease, run: input.run,
      context: delivery.context, prompt: input.prompt, toolResultContinuations: input.toolResultContinuations });
    // The runner reacquires a fresh fence. An HTTP request cannot own its lease.
    await releaseRuntimeLease(input.lease);
    // Startup failure does not erase acceptance. The composition-owned wake-up
    // loop can retry accepted receipts without re-submitting the user's input.
    await launch(execution, reference).catch(() => console.warn("agent.dispatch.pending"));
    const accessRequest = new Request(delivery.request.url, { headers: delivery.request.headers });
    const resources = requirePlatformResources();
    let detached = false, wake: (() => void) | undefined, cursor = 0, terminal = false;
    let buffered: { cursor: number; chunk: UIMessageChunk }[] = [];
    return new ReadableStream<UIMessageChunk>({
      pull(controller) {
        return withPlatformResources(resources, async () => {
          try {
            while (!detached) {
              if (buffered.length) {
                const event = buffered.shift()!;
                controller.enqueue(event.chunk);cursor = event.cursor;
                if (!buffered.length && terminal) controller.close();
                return;
              }
              if (terminal) { controller.close();return; }
              const actor = await resolveActor(accessRequest);
              if (!actor?.organizationId) throw new Error("对话访问权限已失效");
              const page = await readNativeExecutionOutput({ executionId: reference.executionId,
                expected: reference, actor, after: cursor });
              if (detached) return;
              buffered = page.events;terminal = page.terminal;
              if (buffered.length || terminal) continue;
              await new Promise<void>(resolve => {
                const timer = setTimeout(() => { wake = undefined;resolve(); }, 150);
                wake = () => { clearTimeout(timer);wake = undefined;resolve(); };
              });
            }
          } catch (error) { if (!detached) controller.error(error); }
        });
      },
      cancel() { detached = true;buffered = [];wake?.(); },
    });
  };
}
