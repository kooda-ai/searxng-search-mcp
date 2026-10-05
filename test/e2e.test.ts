import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

if (!fs.existsSync("dist/index.js")) {
  throw new Error("dist/index.js not found: run npm run build first (or use npm run test:e2e)");
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function resultText(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function searchPayload(): Record<string, unknown> {
  return {
    query: "linux",
    results: [
      {
        url: "https://example.com/kernel",
        title: "Linux kernel",
        content: "The Linux kernel is...",
        engine: "duckduckgo",
        engines: ["duckduckgo", "brave"],
        score: 4.2,
        category: "general",
        publishedDate: "2026-09-01T12:00:00+00:00",
        thumbnail: "",
        img_src: "",
      },
      {
        url: "https://example.com/img.png",
        title: "Tux",
        content: "",
        engine: "bing",
        engines: ["bing"],
        score: 1.0,
        category: "images",
        img_src: "https://example.com/img.png",
        thumbnail: "https://example.com/t.png",
        resolution: "800x600",
      },
      {
        url: "https://example.com/tolerance",
        title: "Unknown fields tolerated",
        content: "A result carrying an unrecognized extra field.",
        engine: "brave",
        engines: ["brave"],
        score: 2.0,
        category: "general",
        foo: "bar",
      },
    ],
    answers: [{ answer: "42", url: "https://example.com/a" }],
    suggestions: ["linux kernel"],
    unresponsive_engines: [["bing", "timeout"]],
  };
}

const seenUrls: string[] = [];
const stderrChunks: string[] = [];

let mockServer: http.Server;
let mockPort: number;
let client: Client;
let transport: StdioClientTransport;
let childPid: number | null;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function lastSearchRequest(): URL {
  const found = [...seenUrls].reverse().find((url) => url.startsWith("/search"));
  if (found === undefined) {
    throw new Error("mock SearXNG never received a /search request");
  }
  return new URL(found, "http://127.0.0.1");
}

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    seenUrls.push(`${url.pathname}${url.search}`);

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q") ?? "";
      if (url.searchParams.get("format") !== "json" || query === "") {
        sendJson(res, 400, { error: "expected format=json and a non-empty q" });
        return;
      }
      if (query === "json-disabled") {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (query === "rate") {
        sendJson(res, 429, { error: "rate limit exceeded" });
        return;
      }
      sendJson(res, 200, { ...searchPayload(), query });
      return;
    }

    if (url.pathname === "/autocompleter") {
      const query = url.searchParams.get("q") ?? "";
      if (query === "boom") {
        sendJson(res, 500, { error: "internal server error" });
        return;
      }
      sendJson(res, 200, ["searxng mcp server", "searxng mcp github"]);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address() as AddressInfo;
  mockPort = address.port;

  transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, SEARXNG_URL: `http://127.0.0.1:${mockPort}` } as Record<string, string>,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));

  client = new Client({ name: "e2e-harness", version: "0.0.0" });
  await client.connect(transport);
  childPid = transport.pid;
});

afterAll(async () => {
  await client.close().catch(() => {});
  mockServer.close();

  if (childPid !== null) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      process.kill(childPid, 0);
      process.kill(childPid, "SIGKILL");
    } catch {}
  }
});

describe("e2e against built dist/index.js with a mock SearXNG", () => {
  it("lists exactly the two tools in order", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["searxng_web_search", "searxng_suggest"]);
  });

  it("returns parsed results, answers, suggestions, and unresponsive engines", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "linux" },
    });

    expect(result.isError).toBeUndefined();

    const structured = result.structuredContent as {
      results: {
        url: string;
        title: string;
        publishedDate: string | null;
        thumbnail?: string;
      }[];
      suggestions: string[];
      unresponsiveEngines: { engine: string; error: string }[];
    };

    expect(structured.results).toHaveLength(3);
    expect(structured.results[0].url).toBe("https://example.com/kernel");
    expect(structured.results[0].title).toBe("Linux kernel");
    expect(typeof structured.results[0].publishedDate).toBe("string");
    expect(structured.results[1].thumbnail).toBeTruthy();
    expect(structured.suggestions).toEqual(["linux kernel"]);
    expect(structured.unresponsiveEngines).toEqual([{ engine: "bing", error: "timeout" }]);

    const text = resultText(result);
    expect(text).toContain("Linux kernel");
    expect(text).toContain("https://example.com/kernel");
    expect(text).toContain("42");
  });

  it("forwards every search parameter to the instance", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: {
        query: "linux",
        categories: "images",
        language: "en",
        time_range: "month",
        pageno: 2,
        safesearch: 1,
        max_results: 5,
      },
    });

    expect(result.isError).toBeUndefined();

    const params = lastSearchRequest().searchParams;
    expect(params.get("q")).toBe("linux");
    expect(params.get("format")).toBe("json");
    expect(params.get("categories")).toBe("images");
    expect(params.get("language")).toBe("en");
    expect(params.get("time_range")).toBe("month");
    expect(params.get("pageno")).toBe("2");
    expect(params.get("safesearch")).toBe("1");
  });

  it("maps upstream 403 to an error result with the settings.yml hint", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "json-disabled" },
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("settings.yml");
    expect(text).toContain("search.formats");
  });

  it("maps upstream 429 to an error result mentioning the rate limit", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "rate" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/rate/i);
  });

  it("returns suggestions as structured content and text", async () => {
    const result = await client.callTool({
      name: "searxng_suggest",
      arguments: { query: "searxng" },
    });

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { suggestions: string[] };
    expect(structured.suggestions).toEqual(["searxng mcp server", "searxng mcp github"]);
    expect(resultText(result)).toContain("searxng mcp server");
  });

  it("maps an autocompleter failure to a readable error result", async () => {
    const result = await client.callTool({
      name: "searxng_suggest",
      arguments: { query: "boom" },
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("500");
    expect(text).toContain("/autocompleter");
  });
});
