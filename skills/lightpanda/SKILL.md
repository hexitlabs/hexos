---
name: lightpanda
description: Lightweight headless browser for fast page fetching, screenshots, and CDP automation.
homepage: https://lightpanda.io
metadata: {"hexos":{"emoji":"🐼","requires":{"bins":["lightpanda"]},"install":[{"id":"script","kind":"script","path":"skills/lightpanda/scripts/install.sh","bins":["lightpanda"],"label":"Install Lightpanda binary"}]}}
---

# Lightpanda — Lightweight Headless Browser

Lightpanda is a headless browser built for AI and automation. It's **much faster and lighter** than Chromium/Playwright — ideal for page fetching, scraping, and simple CDP tasks where you don't need a full browser.

## When to Use Lightpanda vs web_fetch vs Playwright

| Use Case | Tool |
|---|---|
| Quick page content as markdown/text | `lightpanda-fetch.js` or `web_fetch` |
| JS-rendered pages (SPAs, dynamic content) | `lightpanda-fetch.js` (handles JS) |
| Screenshots of pages | `lightpanda-screenshot.js` |
| Complex browser automation (clicks, forms, navigation) | Playwright (full browser) |
| High-volume scraping with low resource usage | Lightpanda |
| Cookie/session management, extensions | Playwright (full browser) |

**Rule of thumb:** If you just need page content or a screenshot, use Lightpanda. If you need to interact with the page (click buttons, fill forms, manage sessions), use Playwright.

## Available Scripts

### 1. `lightpanda-fetch.js` — Quick Page Fetch

Fetches a URL and dumps content in various formats. No CDP server needed — runs as a standalone command.

```bash
# Markdown output (default)
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com

# HTML output
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com --format html

# Semantic tree (for structured parsing)
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com --format semantic_tree

# With custom timeout (ms)
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com --timeout 15000

# Strip JavaScript and CSS from output
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com --strip js,css

# Include iframe content
node skills/lightpanda/scripts/lightpanda-fetch.js https://example.com --with-frames
```

**Formats:**
- `markdown` — Clean readable text (default, best for LLM consumption)
- `html` — Raw HTML
- `semantic_tree` — Structured accessibility tree
- `semantic_tree_text` — Text-only semantic tree

### 2. `lightpanda-screenshot.js` — Page Screenshots via CDP

Takes screenshots by connecting to a Lightpanda CDP server. Requires the CDP server to be running.

```bash
# Start CDP server first (in background or another terminal)
lightpanda serve --host 127.0.0.1 --port 9223 &

# Basic screenshot
node skills/lightpanda/scripts/lightpanda-screenshot.js https://example.com -o screenshot.png

# Full-page screenshot
node skills/lightpanda/scripts/lightpanda-screenshot.js https://example.com -o full.png --full-page

# JPEG with quality setting
node skills/lightpanda/scripts/lightpanda-screenshot.js https://example.com -o shot.jpg --format jpeg --quality 80

# Custom CDP endpoint
node skills/lightpanda/scripts/lightpanda-screenshot.js https://example.com -o shot.png --cdp-url http://127.0.0.1:9333
```

### 3. `install.sh` — Install Lightpanda Binary

```bash
# Install (auto-detects OS)
bash skills/lightpanda/scripts/install.sh

# Check if already installed
which lightpanda
```

Supports Linux x86_64 and macOS aarch64. Downloads nightly builds from GitHub.

## CDP Server

Lightpanda runs a CDP (Chrome DevTools Protocol) server compatible with Puppeteer and Playwright.

```bash
# Start server
lightpanda serve --host 127.0.0.1 --port 9223

# With longer timeout (default 10s)
lightpanda serve --host 127.0.0.1 --port 9223 --timeout 60

# CDP endpoint will be at:
# HTTP: http://127.0.0.1:9223
# WebSocket: ws://127.0.0.1:9223
```

You can connect any CDP client (puppeteer-core, playwright, etc.) to this endpoint.

## MCP Server

Lightpanda can also run as an MCP (Model Context Protocol) server:

```bash
lightpanda mcp
```

This provides tool access over stdio for MCP-compatible clients.

## Direct CLI Usage

Beyond the wrapper scripts, you can use `lightpanda` directly:

```bash
# Quick fetch
lightpanda fetch --dump markdown https://example.com

# Fetch with robot.txt compliance
lightpanda fetch --dump markdown --obey_robots https://example.com

# Fetch stripping all UI elements
lightpanda fetch --dump markdown --strip_mode full https://example.com
```

## Notes

- Lightpanda is ~10-50x faster than Chromium for page fetching
- Uses ~10x less memory than a full browser
- CDP support covers core protocol — some advanced Chromium-specific CDP methods may not be available
- No GPU rendering — screenshots are server-side rendered
- Binary is a single static file, no dependencies needed
