# searxng-search-mcp

[![CI](https://github.com/kooda-ai/searxng-search-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kooda-ai/searxng-search-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/searxng-search-mcp.svg)](https://www.npmjs.com/package/searxng-search-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that exposes [SearXNG](https://docs.searxng.org) web search and search suggestions to AI clients, distributed via [npx](https://www.npmjs.com/package/searxng-search-mcp).

## Tools

| Tool | Description |
| --- | --- |
| `searxng_web_search` | Full web search: ranked results, instant answers, and query suggestions. |
| `searxng_suggest` | Autocomplete suggestions for a partial query. |

### `searxng_web_search` parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | string | Required. Search query. |
| `categories` | string | Comma-separated categories, e.g. `general` (default), `images`, `videos`, `news`, `it`, `music`, `science`, `files`, `social media`. |
| `language` | string | Result language as BCP-47 code, e.g. `en`, `tr-TR`, or `all`. |
| `time_range` | string | One of `day`, `week`, `month`, `year`. |
| `pageno` | integer | Page number, 1-based (default 1). |
| `engines` | string | Comma-separated SearXNG engine names to use instead of categories. |
| `safesearch` | integer | `0` off, `1` moderate, `2` strict. |
| `max_results` | integer | Maximum number of results to return, clamped to 1-50 (default from `SEARXNG_MAX_RESULTS`). |

### `searxng_suggest` parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | string | Required. Partial query to complete. |

## Requirements

- Node.js >= 20
- A SearXNG instance with the JSON format enabled. Most public instances block the JSON API (403), so a self-hosted instance is the supported path — see [Running a local SearXNG instance](#running-a-local-searxng-instance).

## Configuration

| Environment variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SEARXNG_URL` | yes | — | Base URL of your SearXNG instance, e.g. `http://localhost:8888`. |
| `SEARXNG_TIMEOUT_MS` | no | `10000` | Request timeout in milliseconds. |
| `SEARXNG_MAX_RESULTS` | no | `20` | Default maximum number of results, clamped to 1-50. |

## Usage

All clients use the same command: `npx -y searxng-search-mcp`, configured with the `SEARXNG_URL` environment variable.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "searxng-search-mcp": {
      "command": "npx",
      "args": ["-y", "searxng-search-mcp"],
      "env": {
        "SEARXNG_URL": "http://localhost:8888"
      }
    }
  }
}
```

### Claude Code

```sh
claude mcp add searxng-search-mcp --env SEARXNG_URL=http://localhost:8888 -- npx -y searxng-search-mcp
```

### opencode

`opencode.json`:

```json
{
  "mcp": {
    "searxng-search-mcp": {
      "type": "local",
      "command": ["npx", "-y", "searxng-search-mcp"],
      "enabled": true,
      "environment": {
        "SEARXNG_URL": "http://localhost:8888"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "searxng-search-mcp": {
      "command": "npx",
      "args": ["-y", "searxng-search-mcp"],
      "env": {
        "SEARXNG_URL": "http://localhost:8888"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "searxng-search-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "searxng-search-mcp"],
      "env": {
        "SEARXNG_URL": "http://localhost:8888"
      }
    }
  }
}
```

## Running a local SearXNG instance

SearXNG disables the JSON output format by default. The instance must be configured to allow it, otherwise search requests return `403`. This repository ships a ready-to-use Docker Compose setup.

`docker-compose.yml`:

```yaml
services:
  searxng:
    image: docker.io/searxng/searxng:latest
    ports:
      - "8888:8080"
    volumes:
      - ./searxng:/etc/searxng
    restart: unless-stopped
```

`searxng/settings.yml`:

```yaml
use_default_settings: true
server:
  secret_key: "searxng-search-mcp-dev-instance-change-me"
search:
  formats:
    - html
    - json
```

Start and verify:

```sh
docker compose up -d
curl 'http://localhost:8888/search?q=test&format=json'
```

The `curl` command must return a JSON object with a `results` array. If it returns `403`, `json` is missing from `search.formats` in `settings.yml` — the two files above are the exact fix.

## Troubleshooting

- **403 Forbidden** — the JSON format is not enabled on the instance. Add `json` to `search.formats` in the SearXNG `settings.yml` and restart (see above).
- **429 Too Many Requests** — the instance rate limiter is throttling requests. Self-host an instance, or add your IP to the limiter `pass_ip` list in `settings.yml`.
- **Timeout / network error** — check that `SEARXNG_URL` points at a reachable instance and adjust `SEARXNG_TIMEOUT_MS` if the instance is slow.

## Development

```sh
npm install          # installs and builds (prepare script)
npm test             # unit + tool + e2e tests (uses a mock SearXNG server)
npm run test:e2e     # e2e only: builds, then spawns dist/index.js against a mock
docker compose up -d
SEARXNG_INTEGRATION_URL=http://localhost:8888 npm run test:integration
```

Smoke-test the server interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```sh
SEARXNG_URL=http://localhost:8888 npx @modelcontextprotocol/inspector node dist/index.js
```

## Publishing

Releases are published to npm by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) when a `v*` tag is pushed. It uses npm trusted publishing (tokenless OIDC) with provenance.

One-time maintainer setup:

- Enable 2FA on your npm account.
- Configure a trusted publisher on npmjs.com bound to this repository and the `publish.yml` workflow.
- Make the repository **public** before the first release — npm provenance requires a public GitHub repository.
- The workflow runs on Node 24, which ships npm >= 11.5 (required for tokenless trusted publishing).

## License

[MIT](LICENSE)
