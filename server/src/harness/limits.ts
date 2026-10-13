function positiveEnv(name: string) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function chatRunLimits() {
  return {
    // Let the native harness finish naturally unless an operator opts into a cap.
    steps: positiveEnv("AI_CHAT_MAX_STEPS"),
    timeout: {
      totalMs: positiveEnv("AI_CHAT_TOTAL_MS"),
      stepMs: positiveEnv("AI_CHAT_STEP_MS"),
      firstChunkMs: positiveEnv("AI_CHAT_FIRST_CHUNK_MS"),
      chunkMs: positiveEnv("AI_CHAT_CHUNK_MS"),
    },
  };
}
