#!/usr/bin/env node

/**
 * lightpanda-fetch.js — Quick page fetch via Lightpanda CLI.
 *
 * Usage:
 *   node lightpanda-fetch.js <url> [--format markdown|html|semantic_tree|semantic_tree_text] [--timeout <ms>] [--strip <modes>] [--with-frames]
 *
 * Examples:
 *   node lightpanda-fetch.js https://example.com
 *   node lightpanda-fetch.js https://example.com --format html
 *   node lightpanda-fetch.js https://example.com --timeout 15000 --strip js,css
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

const LIGHTPANDA_BIN = process.env.LIGHTPANDA_BIN || "lightpanda";
const VALID_FORMATS = ["markdown", "html", "semantic_tree", "semantic_tree_text"];
const DEFAULT_FORMAT = "markdown";
const DEFAULT_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    url: null,
    format: DEFAULT_FORMAT,
    timeout: DEFAULT_TIMEOUT_MS,
    strip: null,
    withFrames: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--format" || arg === "-f") {
      result.format = args[++i];
    } else if (arg === "--timeout" || arg === "-t") {
      result.timeout = parseInt(args[++i], 10);
    } else if (arg === "--strip") {
      result.strip = args[++i];
    } else if (arg === "--with-frames") {
      result.withFrames = true;
    } else if (!arg.startsWith("-") && !result.url) {
      result.url = arg;
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Usage: node lightpanda-fetch.js <url> [options]

Options:
  --format, -f <format>   Output format: markdown, html, semantic_tree, semantic_tree_text
                           (default: markdown)
  --timeout, -t <ms>      Timeout in milliseconds (default: 30000)
  --strip <modes>         Strip tag groups: js, css, ui, full (comma-separated)
  --with-frames           Include iframe content
  --help, -h              Show this help

Examples:
  node lightpanda-fetch.js https://news.ycombinator.com
  node lightpanda-fetch.js https://example.com --format html --timeout 15000
  node lightpanda-fetch.js https://example.com --strip js,css --with-frames
`.trim());
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

  if (!VALID_FORMATS.includes(opts.format)) {
    console.error(`Error: Invalid format "${opts.format}". Must be one of: ${VALID_FORMATS.join(", ")}`);
    process.exit(1);
  }

  if (isNaN(opts.timeout) || opts.timeout <= 0) {
    console.error("Error: Timeout must be a positive number in milliseconds.");
    process.exit(1);
  }

  // Build command args
  const cmdArgs = ["fetch", "--dump", opts.format];

  if (opts.strip) {
    cmdArgs.push("--strip_mode", opts.strip);
  }

  if (opts.withFrames) {
    cmdArgs.push("--with_frames");
  }

  // Set HTTP timeout to match our process timeout (lightpanda uses ms)
  cmdArgs.push("--http_timeout", String(opts.timeout));

  cmdArgs.push(opts.url);

  try {
    const { stdout, stderr } = await execFileAsync(LIGHTPANDA_BIN, cmdArgs, {
      timeout: opts.timeout + 5000, // give a bit extra for process overhead
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      env: { ...process.env },
    });

    if (stderr) {
      // Lightpanda logs to stderr — only show if no stdout
      if (!stdout.trim()) {
        console.error(stderr);
      }
    }

    if (stdout.trim()) {
      process.stdout.write(stdout);
    } else {
      console.error("Warning: No output received from Lightpanda.");
      process.exit(1);
    }
  } catch (err) {
    if (err.killed) {
      console.error(`Error: Lightpanda timed out after ${opts.timeout}ms fetching ${opts.url}`);
      process.exit(124);
    }

    if (err.code === "ENOENT") {
      console.error(`Error: Lightpanda binary not found at "${LIGHTPANDA_BIN}".`);
      console.error("Install it with: bash skills/lightpanda/scripts/install.sh");
      process.exit(127);
    }

    // Include stderr in error output if available
    const detail = err.stderr?.trim() || err.message;
    console.error(`Error fetching ${opts.url}: ${detail}`);
    process.exit(err.code && typeof err.code === "number" ? err.code : 1);
  }
}

main();
