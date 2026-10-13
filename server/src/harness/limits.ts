function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function chatRunLimits() {
  return {
    steps: Math.max(2, Math.min(32, positiveEnv("AI_CHAT_MAX_STEPS", 16))),
    timeout: {
      totalMs: positiveEnv("AI_CHAT_TOTAL_MS", 300_000),
      stepMs: positiveEnv("AI_CHAT_STEP_MS", 90_000),
      firstChunkMs: positiveEnv("AI_CHAT_FIRST_CHUNK_MS", 45_000),
      chunkMs: positiveEnv("AI_CHAT_CHUNK_MS", 30_000),
    },
  };
}
