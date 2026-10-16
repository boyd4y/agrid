export type EnvironmentMode = "development" | "production" | "test";
export function loadEnvironment(options?: {
  root?: string;
  env?: Record<string, string | undefined>;
  mode?: string;
}): EnvironmentMode;
