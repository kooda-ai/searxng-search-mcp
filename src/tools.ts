import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Config } from "./config.js";
import { search, SearxngError, suggest } from "./searxng.js";
import type { SearchParams, SearchResult } from "./searxng.js";

const searchOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      content: z.string(),
      engines: z.array(z.string()),
      score: z.number(),
      category: z.string(),
      publishedDate: z.string().nullable(),
      thumbnail: z.string().optional(),
      imgSrc: z.string().optional(),
    }),
  ),
  answers: z.array(z.record(z.string(), z.unknown())),
  suggestions: z.array(z.string()),
  unresponsiveEngines: z.array(
    z.object({
      engine: z.string(),
      error: z.string(),
    }),
  ),
});

const suggestOutputSchema = z.object({
  suggestions: z.array(z.string()),
});

const annotations = { readOnlyHint: true, openWorldHint: true } as const;

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "searxng-search-mcp", version: "0.1.0" });

  server.registerTool(
    "searxng_web_search",
    {
      description:
        "Search the web through a SearXNG instance. Returns ranked results, instant answers, and query suggestions.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
        categories: z
          .string()
          .optional()
          .describe(
            "Comma-separated categories, e.g. 'general' (default), 'images', 'videos', 'news', 'it', 'music', 'science', 'files', 'social media'",
          ),
        language: z
          .string()
          .optional()
          .describe("Result language as BCP-47 code, e.g. 'en', 'tr-TR', or 'all'"),
        time_range: z
          .enum(["day", "week", "month", "year"])
          .optional()
          .describe("Restrict to results from this period"),
        pageno: z.number().int().min(1).optional().describe("Page number, 1-based (default 1)"),
        engines: z
          .string()
          .optional()
          .describe("Comma-separated SearXNG engine names to use instead of categories"),
        safesearch: z.number().int().min(0).max(2).optional().describe("0 off, 1 moderate, 2 strict"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return, 1-50 (default from SEARXNG_MAX_RESULTS or 20)"),
      }),
      outputSchema: searchOutputSchema,
      annotations,
    },
    async (args) => {
      try {
        const params: SearchParams = { query: args.query };
        if (args.categories !== undefined) {
          params.categories = args.categories;
        }
        if (args.language !== undefined) {
          params.language = args.language;
        }
        if (args.pageno !== undefined) {
          params.pageno = args.pageno;
        }
        if (args.time_range !== undefined) {
          params.timeRange = args.time_range;
        }
        if (args.engines !== undefined) {
          params.engines = args.engines;
        }
        if (args.safesearch !== undefined) {
          params.safesearch = args.safesearch as 0 | 1 | 2;
        }
        if (args.max_results !== undefined) {
          params.maxResults = args.max_results;
        }
        const result = await search(cfg, params);
        return {
          content: [{ type: "text" as const, text: renderSearchMarkdown(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: errorMessage(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "searxng_suggest",
    {
      description: "Get search query autocomplete suggestions from the SearXNG instance.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Partial search query"),
      }),
      outputSchema: suggestOutputSchema,
      annotations,
    },
    async (args) => {
      try {
        const suggestions = await suggest(cfg, args.query);
        return {
          content: [{ type: "text" as const, text: suggestions.join("\n") }],
          structuredContent: { suggestions },
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: errorMessage(error) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

function errorMessage(error: unknown): string {
  if (error instanceof SearxngError) {
    return error.message;
  }
  if (error instanceof Error) {
    return `Unexpected error while contacting SearXNG: ${error.message}`;
  }
  return "Unexpected error while contacting SearXNG";
}

function renderSearchMarkdown(result: SearchResult): string {
  const lines: string[] = [];

  if (result.answers.length > 0) {
    lines.push("**Answers**");
    for (const answer of result.answers) {
      lines.push(`- ${answerText(answer)}`);
    }
    lines.push("");
  }

  lines.push("**Results**");
  for (const [index, item] of result.results.entries()) {
    lines.push(`${index + 1}. [${item.title}](${item.url})`);
    if (item.content !== "") {
      lines.push(`   ${truncate(item.content, 300)}`);
    }
    const meta =
      item.publishedDate !== null
        ? `${item.engines.join(", ")} · ${item.publishedDate}`
        : item.engines.join(", ");
    if (meta !== "") {
      lines.push(`   ${meta}`);
    }
  }

  if (result.suggestions.length > 0) {
    lines.push("");
    lines.push(`**Suggestions**: ${result.suggestions.join(", ")}`);
  }

  if (result.unresponsiveEngines.length > 0) {
    lines.push("");
    lines.push(
      `**Unresponsive engines**: ${result.unresponsiveEngines
        .map((engine) => `${engine.engine} (${engine.error})`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

function answerText(answer: Record<string, unknown>): string {
  for (const key of ["answer", "content"]) {
    const value = answer[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return JSON.stringify(answer);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
