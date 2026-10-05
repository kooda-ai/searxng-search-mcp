#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig } from "./config.js";
import { createServer } from "./tools.js";

try {
  const cfg = loadConfig();
  void serveStdio(() => createServer(cfg));
  console.error("searxng-search-mcp running on stdio");
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(`Failed to start searxng-search-mcp: ${error.message}`);
  } else {
    console.error("Failed to start searxng-search-mcp");
  }
  process.exit(1);
}
