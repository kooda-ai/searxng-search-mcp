export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface Config {
  baseUrl: URL;
  timeoutMs: number;
  maxResults: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = env.SEARXNG_URL;
  if (rawUrl === undefined || rawUrl.trim() === "") {
    throw new ConfigError(
      "SEARXNG_URL is required but not set. Point it at the base URL of a SearXNG instance with the JSON format enabled, e.g. SEARXNG_URL=http://localhost:8888. See README.md for configuration instructions.",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl.trim().replace(/\/+$/, ""));
  } catch {
    throw new ConfigError(
      `SEARXNG_URL is not a valid URL: ${rawUrl}. It must be an absolute URL including the protocol, e.g. http://localhost:8888. See README.md for configuration instructions.`,
    );
  }

  const timeoutMs = parseEnvInteger(env.SEARXNG_TIMEOUT_MS, "SEARXNG_TIMEOUT_MS", 10000);
  if (timeoutMs < 1) {
    throw new ConfigError(
      `SEARXNG_TIMEOUT_MS must be a positive integer, got: ${env.SEARXNG_TIMEOUT_MS}`,
    );
  }

  const maxResults = clamp(
    parseEnvInteger(env.SEARXNG_MAX_RESULTS, "SEARXNG_MAX_RESULTS", 20),
    1,
    50,
  );

  return { baseUrl, timeoutMs, maxResults };
}

function parseEnvInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
