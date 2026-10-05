import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/tools.js";

const cfg = loadConfig({
  SEARXNG_URL: "http://example.test",
  SEARXNG_TIMEOUT_MS: "1000",
  SEARXNG_MAX_RESULTS: "20",
});

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const searchFixture = {
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
    },
  ],
  answers: [{ answer: "Linux is a kernel", url: "https://kernel.org" }],
  suggestions: ["linux kernel"],
  unresponsive_engines: [["bing", "timeout"]],
};

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function resultText(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

let client: Client;
let server: McpServer;

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.1" });
  server = createServer(cfg);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("searxng-search-mcp tools", () => {
  it("lists exactly the two tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["searxng_web_search", "searxng_suggest"]);
  });

  it("returns structured content and markdown for a successful web search", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchFixture));

    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "linux" },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      query: "linux",
      results: [
        {
          url: "https://kernel.org/",
          title: "The Linux Kernel Archives",
          content: "Kernel source and documentation.",
          engines: ["duckduckgo", "brave"],
          score: 4.2,
          category: "general",
          publishedDate: "2026-09-01T12:00:00+00:00",
        },
      ],
      answers: [{ answer: "Linux is a kernel", url: "https://kernel.org" }],
      suggestions: ["linux kernel"],
      unresponsiveEngines: [{ engine: "bing", error: "timeout" }],
    });

    const text = resultText(result);
    expect(text).toContain("The Linux Kernel Archives");
    expect(text).toContain("https://kernel.org/");
    expect(text).toContain("Linux is a kernel");
  });

  it("rejects an invalid time_range before calling fetch", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "linux", time_range: "hour" },
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing query before calling fetch", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { categories: "news" },
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces upstream 403 as an error result with the settings.yml hint", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));

    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "linux" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("settings.yml");
  });

  it("returns suggestions as structured content and one per line as text", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(["linux kernel", "linux mint"]));

    const result = await client.callTool({
      name: "searxng_suggest",
      arguments: { query: "lin" },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ suggestions: ["linux kernel", "linux mint"] });
    expect(resultText(result).split("\n")).toEqual(["linux kernel", "linux mint"]);
  });

  it("handles an empty suggestions array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const result = await client.callTool({
      name: "searxng_suggest",
      arguments: { query: "zzz" },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ suggestions: [] });
    expect(resultText(result)).toBe("");
  });
});
