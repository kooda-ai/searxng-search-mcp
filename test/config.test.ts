import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("throws ConfigError with guidance when SEARXNG_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/SEARXNG_URL/);
    expect(() => loadConfig({})).toThrow(/README/);
  });

  it("throws ConfigError when SEARXNG_URL is empty or whitespace", () => {
    expect(() => loadConfig({ SEARXNG_URL: "" })).toThrow(ConfigError);
    expect(() => loadConfig({ SEARXNG_URL: "   " })).toThrow(ConfigError);
  });

  it("throws ConfigError for an invalid SEARXNG_URL", () => {
    expect(() => loadConfig({ SEARXNG_URL: "not-a-url" })).toThrow(ConfigError);
    expect(() => loadConfig({ SEARXNG_URL: "http://[::1" })).toThrow(ConfigError);
  });

  it("normalizes a trailing slash in the base URL", () => {
    const withSlash = loadConfig({ SEARXNG_URL: "http://localhost:8888/" });
    const withoutSlash = loadConfig({ SEARXNG_URL: "http://localhost:8888" });
    expect(withSlash.baseUrl.href).toBe(withoutSlash.baseUrl.href);
    expect(withSlash.baseUrl.origin).toBe("http://localhost:8888");
    expect(new URL("search", withSlash.baseUrl).href).toBe("http://localhost:8888/search");
  });

  it("applies defaults for timeout and max results", () => {
    const config = loadConfig({ SEARXNG_URL: "http://localhost:8888" });
    expect(config.timeoutMs).toBe(10000);
    expect(config.maxResults).toBe(20);
  });

  it("parses custom timeout and max results values", () => {
    const config = loadConfig({
      SEARXNG_URL: "http://example.com",
      SEARXNG_TIMEOUT_MS: "2500",
      SEARXNG_MAX_RESULTS: "5",
    });
    expect(config.timeoutMs).toBe(2500);
    expect(config.maxResults).toBe(5);
  });

  it("throws ConfigError for a non-positive SEARXNG_TIMEOUT_MS", () => {
    expect(() =>
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_TIMEOUT_MS: "0" }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_TIMEOUT_MS: "-5" }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError for non-numeric SEARXNG_TIMEOUT_MS", () => {
    expect(() =>
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_TIMEOUT_MS: "fast" }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError for non-numeric SEARXNG_MAX_RESULTS", () => {
    expect(() =>
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_MAX_RESULTS: "many" }),
    ).toThrow(ConfigError);
  });

  it("clamps max results to the 1..50 range", () => {
    expect(
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_MAX_RESULTS: "0" }).maxResults,
    ).toBe(1);
    expect(
      loadConfig({ SEARXNG_URL: "http://localhost:8888", SEARXNG_MAX_RESULTS: "100" }).maxResults,
    ).toBe(50);
  });
});
