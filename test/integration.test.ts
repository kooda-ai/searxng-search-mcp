import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const integrationUrl = process.env.SEARXNG_INTEGRATION_URL;
const distReady = fs.existsSync("dist/index.js");

if (integrationUrl !== undefined && !distReady) {
  console.warn("Skipping integration tests: dist/index.js is missing; run npm run build first");
}

const shouldRun = integrationUrl !== undefined && integrationUrl !== "" && distReady;

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let client: Client;

describe.skipIf(!shouldRun)("searxng integration against a real instance", () => {
  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...(process.env as Record<string, string>),
        SEARXNG_URL: integrationUrl as string,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "integration-harness", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close().catch(() => {});
  });

  it("performs a web search against the real instance", async () => {
    const result = await client.callTool({
      name: "searxng_web_search",
      arguments: { query: "searxng", max_results: 5 },
    });

    expect(result.isError).toBeUndefined();

    const structured = result.structuredContent as {
      results: { url: string; title: string }[];
    };
    expect(Array.isArray(structured.results)).toBe(true);
    expect(structured.results.length).toBeGreaterThan(0);
    for (const item of structured.results) {
      expect(typeof item.url).toBe("string");
      expect(item.url.length).toBeGreaterThan(0);
      expect(typeof item.title).toBe("string");
    }
  });

  it("fetches suggestions from the real instance", async () => {
    const result = await client.callTool({
      name: "searxng_suggest",
      arguments: { query: "sear" },
    });

    expect(result.isError).toBeUndefined();

    const structured = result.structuredContent as { suggestions: string[] };
    expect(Array.isArray(structured.suggestions)).toBe(true);
  });
});
