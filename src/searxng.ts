import type { Config } from "./config.js";

export class SearxngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearxngError";
  }
}

export class SearxngApiError extends SearxngError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SearxngApiError";
    this.status = status;
  }
}

export class SearxngNetworkError extends SearxngError {
  constructor(message: string) {
    super(message);
    this.name = "SearxngNetworkError";
  }
}

export interface SearchParams {
  query: string;
  categories?: string;
  language?: string;
  pageno?: number;
  timeRange?: "day" | "week" | "month" | "year";
  engines?: string;
  safesearch?: 0 | 1 | 2;
  maxResults?: number;
}

export interface NormalizedResult {
  url: string;
  title: string;
  content: string;
  engines: string[];
  score: number;
  category: string;
  publishedDate: string | null;
  thumbnail?: string;
  imgSrc?: string;
}

export interface SearchResult {
  query: string;
  results: NormalizedResult[];
  answers: Record<string, unknown>[];
  suggestions: string[];
  unresponsiveEngines: { engine: string; error: string }[];
}

const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": "searxng-search-mcp/0.1.0 (+https://github.com/kooda-ai/searxng-search-mcp)",
  Accept: "application/json",
};

export async function search(cfg: Config, params: SearchParams): Promise<SearchResult> {
  const url = new URL("search", cfg.baseUrl);
  const query = new URLSearchParams();
  query.set("q", params.query);
  query.set("format", "json");
  if (params.categories !== undefined) {
    query.set("categories", params.categories);
  }
  if (params.language !== undefined) {
    query.set("language", params.language);
  }
  if (params.pageno !== undefined) {
    query.set("pageno", String(params.pageno));
  }
  if (params.timeRange !== undefined) {
    query.set("time_range", params.timeRange);
  }
  if (params.engines !== undefined) {
    query.set("engines", params.engines);
  }
  if (params.safesearch !== undefined) {
    query.set("safesearch", String(params.safesearch));
  }
  url.search = query.toString();

  const response = await request(cfg, url);
  const body = await response.text();

  if (response.status === 403) {
    throw new SearxngApiError(
      response.status,
      "SearXNG returned HTTP 403: the JSON search format is not enabled on this instance. Add 'json' to search.formats in the instance's settings.yml and restart it.",
    );
  }
  if (response.status === 429) {
    throw new SearxngApiError(
      response.status,
      "SearXNG returned HTTP 429: the instance's rate limit was exceeded (its limiter caps JSON API requests). Wait before retrying or use a self-hosted instance with the limiter disabled.",
    );
  }
  if (!response.ok) {
    throw new SearxngApiError(
      response.status,
      `SearXNG returned HTTP ${response.status}: ${excerpt(body)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new SearxngError(`SearXNG returned a non-JSON response: ${excerpt(body)}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new SearxngError(`SearXNG returned an unexpected search response: ${excerpt(body)}`);
  }
  const raw = data as Record<string, unknown>;

  const maxResults = clamp(params.maxResults ?? cfg.maxResults, 1, 50);
  const results = (Array.isArray(raw.results) ? raw.results : [])
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(normalizeResult)
    .slice(0, maxResults);

  return {
    query: typeof raw.query === "string" ? raw.query : params.query,
    results,
    answers: (Array.isArray(raw.answers) ? raw.answers : []).filter(
      (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
    ),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).filter(
      (item): item is string => typeof item === "string",
    ),
    unresponsiveEngines: normalizeUnresponsiveEngines(raw.unresponsive_engines),
  };
}

export async function suggest(cfg: Config, query: string): Promise<string[]> {
  const url = new URL("autocompleter", cfg.baseUrl);
  url.search = new URLSearchParams({ q: query }).toString();

  const response = await request(cfg, url);
  const body = await response.text();

  if (!response.ok) {
    throw new SearxngApiError(
      response.status,
      `SearXNG returned HTTP ${response.status} from /autocompleter: ${excerpt(body)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new SearxngError("Autocomplete is disabled or unsupported on this instance");
  }
  if (!Array.isArray(data)) {
    throw new SearxngError("Autocomplete is disabled or unsupported on this instance");
  }
  return data.filter((item): item is string => typeof item === "string");
}

async function request(cfg: Config, url: URL): Promise<Response> {
  try {
    return await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (error) {
    throw toNetworkError(error, cfg.timeoutMs);
  }
}

function toNetworkError(error: unknown, timeoutMs: number): SearxngNetworkError {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new SearxngNetworkError(
      `Request to SearXNG timed out after ${timeoutMs} ms. Increase SEARXNG_TIMEOUT_MS or verify the instance is reachable.`,
    );
  }
  const cause = error instanceof Error ? error.message : String(error);
  return new SearxngNetworkError(
    `Could not reach the SearXNG instance: ${cause}. Check SEARXNG_URL and network connectivity.`,
  );
}

function normalizeResult(raw: Record<string, unknown>): NormalizedResult {
  const engines = (Array.isArray(raw.engines) ? raw.engines : []).filter(
    (item): item is string => typeof item === "string",
  );
  const fallbackEngine = typeof raw.engine === "string" ? raw.engine : "";

  const result: NormalizedResult = {
    url: typeof raw.url === "string" ? raw.url : "",
    title: typeof raw.title === "string" ? raw.title : "",
    content: typeof raw.content === "string" ? raw.content : "",
    engines:
      engines.length > 0
        ? engines
        : fallbackEngine !== ""
          ? [fallbackEngine]
          : [],
    score: typeof raw.score === "number" ? raw.score : 0,
    category: typeof raw.category === "string" ? raw.category : "",
    publishedDate: typeof raw.publishedDate === "string" ? raw.publishedDate : null,
  };
  if (typeof raw.thumbnail === "string" && raw.thumbnail !== "") {
    result.thumbnail = raw.thumbnail;
  }
  if (typeof raw.img_src === "string" && raw.img_src !== "") {
    result.imgSrc = raw.img_src;
  }
  return result;
}

function normalizeUnresponsiveEngines(raw: unknown): { engine: string; error: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const engines: { engine: string; error: string }[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const engine = entry[0];
    const message = entry[1];
    if (typeof engine === "string" && typeof message === "string") {
      engines.push({ engine, error: message });
    }
  }
  return engines;
}

function excerpt(body: string): string {
  return body.slice(0, 200);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
