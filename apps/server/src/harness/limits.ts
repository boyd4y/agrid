function positiveEnv(name: string) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Safe MVP defaults; each AI_CHAT_* setting accepts a positive integer. */
export function chatRunLimits() {
  return {
    steps: positiveEnv("AI_CHAT_MAX_STEPS") ?? 40,
    timeout: {
      totalMs: positiveEnv("AI_CHAT_TOTAL_MS") ?? 10 * 60_000,
      stepMs: positiveEnv("AI_CHAT_STEP_MS") ?? 2 * 60_000,
      firstChunkMs: positiveEnv("AI_CHAT_FIRST_CHUNK_MS") ?? 60_000,
      chunkMs: positiveEnv("AI_CHAT_CHUNK_MS") ?? 30_000,
    },
  };
}

export function chatRequestLimits() {
  return {
    maxMessagesPerRequest: positiveEnv("AI_CHAT_MAX_MESSAGES") ?? 50,
    maxMessagePartBytes: positiveEnv("AI_CHAT_MAX_MESSAGE_PART_BYTES") ?? 256 * 1024,
    maxPromptBytes: positiveEnv("AI_CHAT_MAX_PROMPT_BYTES") ?? 64 * 1024,
    maxRequestBodyBytes: positiveEnv("AI_CHAT_MAX_REQUEST_BODY_BYTES") ?? 512 * 1024,
    concurrentRunsPerUser: positiveEnv("AI_CHAT_CONCURRENT_RUNS_PER_USER") ?? 2,
    concurrentRunsPerOrg: positiveEnv("AI_CHAT_CONCURRENT_RUNS_PER_ORG") ?? 4,
    concurrentRunsPlatform: positiveEnv("AI_CHAT_CONCURRENT_RUNS_PLATFORM") ?? 32,
  };
}
