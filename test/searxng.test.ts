import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  search,
  suggest,
  SearxngApiError,
  SearxngError,
  SearxngNetworkError,
} from "../src/searxng.js";

const cfg = loadConfig({ SEARXNG_URL: "http://example.test" });

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function emptySearchResponse(): Record<string, unknown> {
  return {
    query: "x",
    results: [],
    answers: [],
    suggestions: [],
    unresponsive_engines: [],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("search", () => {
  it("sends the full parameter set as query string parameters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptySearchResponse()));

    await search(cfg, {
      query: "linux kernel",
      categories: "news,it",
      language: "tr-TR",
      pageno: 2,
      timeRange: "week",
      engines: "duckduckgo,brave",
      safesearch: 1,
      maxResults: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const calledUrl = new URL(call[0] as string);
    expect(calledUrl.href).toMatch(/^http:\/\/example\.test\/search\?/);
    expect(calledUrl.searchParams.get("q")).toBe("linux kernel");
    expect(calledUrl.searchParams.get("format")).toBe("json");
    expect(calledUrl.searchParams.get("categories")).toBe("news,it");
    expect(calledUrl.searchParams.get("language")).toBe("tr-TR");
    expect(calledUrl.searchParams.get("pageno")).toBe("2");
    expect(calledUrl.searchParams.get("time_range")).toBe("week");
    expect(calledUrl.searchParams.get("engines")).toBe("duckduckgo,brave");
    expect(calledUrl.searchParams.get("safesearch")).toBe("1");

    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^searxng-search-mcp\//);
    expect(headers["Accept"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends only q and format for minimal parameters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptySearchResponse()));

    await search(cfg, { query: "zig" });

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe("/search");
    expect(calledUrl.searchParams.get("q")).toBe("zig");
    expect(calledUrl.searchParams.get("format")).toBe("json");
    expect(calledUrl.searchParams.size).toBe(2);
  });

  it("maps HTTP 403 to an actionable SearxngApiError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));

    const error = await search(cfg, { query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngApiError);
    expect((error as SearxngApiError).status).toBe(403);
    expect((error as SearxngApiError).message).toContain("settings.yml");
    expect((error as SearxngApiError).message).toContain("search.formats");
  });

  it("maps HTTP 429 to a rate limit SearxngApiError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));

    const error = await search(cfg, { query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngApiError);
    expect((error as SearxngApiError).status).toBe(429);
    expect((error as SearxngApiError).message).toMatch(/rate limit/);
  });

  it("maps other non-200 statuses to SearxngApiError with a body excerpt", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom boom boom boom", { status: 500 }));

    const error = await search(cfg, { query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngApiError);
    expect((error as SearxngApiError).status).toBe(500);
    expect((error as SearxngApiError).message).toContain("HTTP 500");
    expect((error as SearxngApiError).message).toContain("boom");
  });

  it("wraps fetch rejections in SearxngNetworkError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const error = await search(cfg, { query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngNetworkError);
    expect((error as SearxngNetworkError).message).toContain("fetch failed");
  });

  it("wraps timeouts in SearxngNetworkError with a timeout hint", async () => {
    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    fetchMock.mockRejectedValueOnce(timeoutError);

    const error = await search(cfg, { query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngNetworkError);
    expect((error as SearxngNetworkError).message).toContain("timed out");
    expect((error as SearxngNetworkError).message).toContain("SEARXNG_TIMEOUT_MS");
  });

  it("normalizes results, dropping empty image fields and tolerating extras", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: "linux",
        results: [
          {
            url: "https://kernel.org/",
            title: "The Linux Kernel Archives",
            content: "Kernel source and documentation.",
            engine: "duckduckgo",
            engines: ["duckduckgo", "brave"],
            score: 4.2,
            category: "general",
            publishedDate: "2026-09-01T12:00:00+00:00",
            thumbnail: "",
            img_src: "",
            template: "default.html",
            positions: [1, 2],
          },
          {
            url: "https://en.wikipedia.org/wiki/Linux",
            title: "Linux",
            content: "Linux is a family of open-source Unix-like operating systems.",
            engine: "wikipedia",
            score: 1.0,
            category: "general",
            publishedDate: null,
          },
        ],
        answers: [{ answer: "Linux is a kernel", url: "https://kernel.org" }],
        suggestions: ["linux kernel"],
        unresponsive_engines: [
          ["bing", "timeout"],
          ["google", "captcha"],
        ],
        infoboxes: [],
        corrections: [],
      }),
    );

    const result = await search(cfg, { query: "linux" });

    expect(result.query).toBe("linux");
    expect(result.results).toHaveLength(2);

    const first = result.results[0]!;
    expect(first.url).toBe("https://kernel.org/");
    expect(first.title).toBe("The Linux Kernel Archives");
    expect(first.engines).toEqual(["duckduckgo", "brave"]);
    expect(first.score).toBe(4.2);
    expect(first.publishedDate).toBe("2026-09-01T12:00:00+00:00");
    expect("thumbnail" in first).toBe(false);
    expect("imgSrc" in first).toBe(false);

    const second = result.results[1]!;
    expect(second.engines).toEqual(["wikipedia"]);
    expect(second.publishedDate).toBeNull();
    expect("thumbnail" in second).toBe(false);
    expect("imgSrc" in second).toBe(false);

    expect(result.answers).toEqual([{ answer: "Linux is a kernel", url: "https://kernel.org" }]);
    expect(result.suggestions).toEqual(["linux kernel"]);
    expect(result.unresponsiveEngines).toEqual([
      { engine: "bing", error: "timeout" },
      { engine: "google", error: "captcha" },
    ]);
  });

  it("keeps non-empty image fields", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: "cat",
        results: [
          {
            url: "https://example.test/cat.jpg",
            title: "Cat",
            content: "",
            engine: "duckduckgo",
            engines: ["duckduckgo"],
            score: 1,
            category: "images",
            publishedDate: null,
            thumbnail: "https://example.test/t_cat.jpg",
            img_src: "https://example.test/cat.jpg",
          },
        ],
        answers: [],
        suggestions: [],
        unresponsive_engines: [],
      }),
    );

    const result = await search(cfg, { query: "cat" });

    expect(result.results[0]!.thumbnail).toBe("https://example.test/t_cat.jpg");
    expect(result.results[0]!.imgSrc).toBe("https://example.test/cat.jpg");
  });

  it("truncates results to maxResults capped at 50", async () => {
    const results = Array.from({ length: 60 }, (_, index) => ({
      url: `https://example.test/${index}`,
      title: `Result ${index}`,
      content: "",
      engine: "duckduckgo",
      engines: ["duckduckgo"],
      score: 1,
      category: "general",
      publishedDate: null,
    }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ query: "many", results, answers: [], suggestions: [], unresponsive_engines: [] }),
    );

    const result = await search(cfg, { query: "many", maxResults: 50 });

    expect(result.results).toHaveLength(50);
    expect(result.results[49]!.url).toBe("https://example.test/49");
  });

  it("falls back to the configured maxResults", async () => {
    const results = Array.from({ length: 30 }, (_, index) => ({
      url: `https://example.test/${index}`,
      title: `Result ${index}`,
      content: "",
      engine: "duckduckgo",
      engines: ["duckduckgo"],
      score: 1,
      category: "general",
      publishedDate: null,
    }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ query: "many", results, answers: [], suggestions: [], unresponsive_engines: [] }),
    );

    const result = await search(cfg, { query: "many" });

    expect(result.results).toHaveLength(20);
  });
});

describe("suggest", () => {
  it("returns the suggestion strings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(["linux kernel", "linux mint"]));

    const suggestions = await suggest(cfg, "lin");

    expect(suggestions).toEqual(["linux kernel", "linux mint"]);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe("/autocompleter");
    expect(calledUrl.searchParams.get("q")).toBe("lin");
  });

  it("maps a non-array response to SearxngError about autocomplete support", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }));

    const error = await suggest(cfg, "lin").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngError);
    expect(error).not.toBeInstanceOf(SearxngApiError);
    expect((error as SearxngError).message).toMatch(/autocomplete/i);
  });

  it("maps non-200 responses to SearxngApiError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));

    const error = await suggest(cfg, "lin").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearxngApiError);
    expect((error as SearxngApiError).status).toBe(503);
  });
});
