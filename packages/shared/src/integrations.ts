/** Public connection metadata. Credential ciphertext is deliberately absent. */
export type IntegrationConnection = {
  id: string;
  provider: "agentmail";
  name: string;
  enabled: boolean;
  state: "unverified" | "connected" | "error";
  lastError: string | null;
  createdAt: string;
};
export type IntegrationInbox = { inboxId: string; address: string; displayName?: string };
/** Incoming endpoints have different verification adapters, one event pipeline. */
export type WebhookEndpoint = {
  id: string;
  name: string;
  kind: "webhook" | "agentmail";
  connectionId: string | null;
  inboxIds: string[];
  receiveUrl: string;
  enabled: boolean;
  state: "pending" | "active" | "error";
  lastError: string | null;
  createdAt: string;
};
