#!/usr/bin/env node

/**
 * lightpanda-screenshot.js — Take screenshots via Lightpanda CDP server.
 *
 * Requires a running Lightpanda CDP server:
 *   lightpanda serve --host 127.0.0.1 --port 9223
 *
 * Usage:
 *   node lightpanda-screenshot.js <url> -o <output-path> [options]
 *
 * Examples:
 *   node lightpanda-screenshot.js https://example.com -o shot.png
 *   node lightpanda-screenshot.js https://example.com -o full.png --full-page
 *   node lightpanda-screenshot.js https://example.com -o shot.jpg --format jpeg --quality 80
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";

// Uses Node.js built-in WebSocket (available in Node 22+)

const DEFAULT_CDP_URL = "http://127.0.0.1:9223";
const DEFAULT_FORMAT = "png";
const DEFAULT_QUALITY = 85;
const DEFAULT_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    url: null,
    output: null,
    fullPage: false,
    format: null, // auto-detect from extension, fallback to png
    quality: DEFAULT_QUALITY,
    cdpUrl: DEFAULT_CDP_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--output" || arg === "-o") {
      result.output = args[++i];
    } else if (arg === "--full-page") {
      result.fullPage = true;
    } else if (arg === "--format") {
      result.format = args[++i];
    } else if (arg === "--quality" || arg === "-q") {
      result.quality = parseInt(args[++i], 10);
    } else if (arg === "--cdp-url") {
      result.cdpUrl = args[++i];
    } else if (arg === "--timeout" || arg === "-t") {
      result.timeout = parseInt(args[++i], 10);
    } else if (!arg.startsWith("-") && !result.url) {
      result.url = arg;
    }
  }

  // Auto-detect format from output extension
  if (!result.format && result.output) {
    const ext = extname(result.output).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") result.format = "jpeg";
    else result.format = DEFAULT_FORMAT;
  }
  if (!result.format) result.format = DEFAULT_FORMAT;

  return result;
}

function printUsage() {
  console.log(`
Usage: node lightpanda-screenshot.js <url> -o <output-path> [options]

Requires a running Lightpanda CDP server:
  lightpanda serve --host 127.0.0.1 --port 9223

Options:
  -o, --output <path>     Output file path (required)
  --full-page             Capture full page (not just viewport)
  --format <fmt>          Image format: png or jpeg (auto-detected from extension)
  --quality, -q <n>       JPEG quality 0-100 (default: 85)
  --cdp-url <url>         CDP server URL (default: http://127.0.0.1:9223)
  --timeout, -t <ms>      Timeout in milliseconds (default: 30000)
  --help, -h              Show this help

Examples:
  node lightpanda-screenshot.js https://example.com -o screenshot.png
  node lightpanda-screenshot.js https://example.com -o full.png --full-page
  node lightpanda-screenshot.js https://example.com -o photo.jpg --quality 90
`.trim());
}

/**
 * Create a CDP sender over WebSocket.
 */
function createCdpConnection(wsUrl, timeout) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP connection timed out after ${timeout}ms`));
    }, timeout);

    ws.addEventListener("open", () => {
      clearTimeout(timer);
      const send = (method, params = {}) => {
        return new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      };
      const close = () => {
        for (const [, p] of pending) p.reject(new Error("Connection closed"));
        pending.clear();
        ws.close();
      };
      resolve({ send, close, ws });
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message || "CDP error"));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      const msg = event.message || "connection failed";
      reject(new Error(`CDP connection failed: ${msg}. Is the CDP server running? (lightpanda serve --host 127.0.0.1 --port 9223)`));
    });

    ws.addEventListener("close", () => {
      clearTimeout(timer);
      for (const [, p] of pending) p.reject(new Error("CDP connection closed unexpectedly"));
      pending.clear();
    });
  });
}

/**
 * Get a WebSocket target URL from the CDP HTTP endpoint.
 */
async function getWsTarget(cdpUrl) {
  const listUrl = new URL("/json/new", cdpUrl).toString();
  const resp = await fetch(listUrl);
  if (!resp.ok) {
    throw new Error(`Failed to create CDP target: ${resp.status} ${resp.statusText}`);
  }
  const target = await resp.json();
  if (target.webSocketDebuggerUrl) {
    return target.webSocketDebuggerUrl;
  }
  throw new Error("No webSocketDebuggerUrl found in CDP target response");
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (!opts.url) {
    console.error("Error: URL is required.\n");
    printUsage();
    process.exit(1);
  }

  if (!opts.output) {
    console.error("Error: Output path is required (-o <path>).\n");
    printUsage();
    process.exit(1);
  }

  let cdp;
  try {
    // Get a WebSocket URL from the CDP server
    console.error(`Connecting to CDP server at ${opts.cdpUrl}...`);
    const wsUrl = await getWsTarget(opts.cdpUrl);
    console.error(`WebSocket target: ${wsUrl}`);

    // Connect via WebSocket
    cdp = await createCdpConnection(wsUrl, opts.timeout);

    // Navigate to the page
    console.error(`Navigating to ${opts.url}...`);
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: opts.url });

    // Wait for page load — use a short delay since Lightpanda loads fast
    await new Promise((r) => setTimeout(r, 2000));

    // Determine clip for full-page screenshots
    let clip;
    if (opts.fullPage) {
      try {
        const metrics = await cdp.send("Page.getLayoutMetrics");
        const size = metrics?.cssContentSize ?? metrics?.contentSize;
        const width = Number(size?.width ?? 0);
        const height = Number(size?.height ?? 0);
        if (width > 0 && height > 0) {
          clip = { x: 0, y: 0, width, height, scale: 1 };
        }
      } catch {
        console.error("Warning: Could not get layout metrics for full-page screenshot.");
      }
    }

    // Capture screenshot
    console.error(`Capturing ${opts.format} screenshot${opts.fullPage ? " (full page)" : ""}...`);
    const screenshotParams = {
      format: opts.format,
      ...(opts.format === "jpeg" ? { quality: Math.max(0, Math.min(100, opts.quality)) } : {}),
      fromSurface: true,
      captureBeyondViewport: true,
      ...(clip ? { clip } : {}),
    };

    const result = await cdp.send("Page.captureScreenshot", screenshotParams);
    const base64 = result?.data;
    if (!base64) {
      throw new Error("Screenshot failed: no data returned from CDP");
    }

    // Save to file
    const buffer = Buffer.from(base64, "base64");
    mkdirSync(dirname(opts.output), { recursive: true });
    writeFileSync(opts.output, buffer);

    console.error(`✅ Screenshot saved: ${opts.output} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    if (cdp) {
      try { cdp.close(); } catch {}
    }
  }
}

main();
