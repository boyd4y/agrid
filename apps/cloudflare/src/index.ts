import { createProductSessionObject } from "./session-object.js";
import { createProductExecutionObject } from "./execution-object.js";
import { createProductValidationObject } from "./validation-object.js";
import { acquire,program,stopCompute,startExecution,publisher,dispatch } from "./composition.js";
import { createProductQueueHandler } from "./queue.js";
import { createProductScheduledHandler } from "./scheduled.js";
import { createHttpApplication } from "./http.js";
import { createProductAutomationServices } from "./automation.js";
import { automationDeliveryId } from "@tabdo/shared";
import { hydrateAgentMailEvent } from "@tabdo/backend/integrations/agentmail";
import { runtimeEnvironment } from "./configuration.js";
import type { ProductEnvironment } from "./configuration.js";

export class ProductSessionObject extends createProductSessionObject<ProductEnvironment>({acquire,stopCompute}) {}
export class ProductExecutionObject extends createProductExecutionObject<ProductEnvironment>({acquire,program,gatewayOrigin:env=>env.GATEWAY_ORIGIN}) {}
export class ProductValidationObject extends createProductValidationObject<ProductEnvironment>(env=>{const value=program(env);return {...value,command:[...value.command,"--validate-questions"]};}) {}
const automations = createProductAutomationServices<ProductEnvironment>({
  acquire,dispatch,runtimeEnvironment,
  requeue: (env,delivery) => publisher(env).publish({id:automationDeliveryId(delivery),body:delivery}),
  async hydrate(env,event) {
    const scope = await acquire(env);
    try { return await hydrateAgentMailEvent({...scope.commands,...scope.integrations},event); }
    finally { await scope.close(); }
  },
});
const queue = createProductQueueHandler<ProductEnvironment>({acquire,startExecution,acceptAutomation:automations.accept});
const scheduled = createProductScheduledHandler<ProductEnvironment>({acquire,publisher});
export default {
  fetch:(request,env,context)=>createHttpApplication(env).fetch(request,env,context),
  queue:(batch,env)=>queue(batch,env),
  scheduled:async(event,env)=>{await automations.reconcile(env);await scheduled(event,env);},
} satisfies ExportedHandler<ProductEnvironment>;
