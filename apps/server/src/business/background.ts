/** Product notifications; transports and transaction lifecycle are injected. */
export type BackgroundWakeup =
  | Readonly<{ kind: "outbox" }>
  | Readonly<{ kind: "schedules" }>
  | Readonly<{ kind: "native-actions"; threadId: string }>;
