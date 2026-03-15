---
summary: "Integrated browser control server + action commands"
read_when:
  - Adding agent-controlled browser automation
  - Debugging why clawd is interfering with your own Chrome
  - Implementing browser settings + lifecycle in the macOS app
---

# Browser (clawd-managed)

HexOS can run a **dedicated Chrome/Brave/Edge/Chromium profile** that the agent controls.
It is isolated from your personal browser and is managed through a small local
control server.

Beginner view:
- Think of it as a **separate, agent-only browser**.
- The `clawd` profile does **not** touch your personal browser profile.
- The agent can **open tabs, read pages, click, and type** in a safe lane.
- The default `chrome` profile uses the **system default Chromium browser** via the
  extension relay; switch to `clawd` for the isolated managed browser.

## What you get

- A separate browser profile named **clawd** (orange accent by default).
- Deterministic tab control (list/open/focus/close).
- Agent actions (click/type/drag/select), snapshots, screenshots, PDFs.
- Optional multi-profile support (`clawd`, `work`, `remote`, ...).

This browser is **not** your daily driver. It is a safe, isolated surface for
agent automation and verification.

## Quick start

```bash
hexos browser --browser-profile clawd status
hexos browser --browser-profile clawd start
hexos browser --browser-profile clawd open https://example.com
hexos browser --browser-profile clawd snapshot
```

If you get “Browser disabled”, enable it in config (see below) and restart the
Gateway.

## Profiles: `clawd` vs `chrome`

- `clawd`: managed, isolated browser (no extension required).
- `chrome`: extension relay to your **system browser** (requires the HexOS
  extension to be attached to a tab).

Set `browser.defaultProfile: "clawd"` if you want managed mode by default.

## Configuration

Browser settings live in `~/.hexos/hexos.json`.

```json5
{
  browser: {
    enabled: true,                    // default: true
    controlUrl: "http://127.0.0.1:18791",
    cdpUrl: "http://127.0.0.1:18792", // defaults to controlUrl + 1
    remoteCdpTimeoutMs: 1500,         // remote CDP HTTP timeout (ms)
    remoteCdpHandshakeTimeoutMs: 3000, // remote CDP WebSocket handshake timeout (ms)
    defaultProfile: "chrome",
    color: "#FF4500",
    headless: false,
    noSandbox: false,
    attachOnly: false,
    executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    profiles: {
      clawd: { cdpPort: 18800, color: "#FF4500" },
      work: { cdpPort: 18801, color: "#0066CC" },
      remote: { cdpUrl: "http://10.0.0.42:9222", color: "#00AA00" }
    }
  }
}
```

Notes:
- `controlUrl` defaults to `http://127.0.0.1:18791`.
- If you override the Gateway port (`gateway.port` or `HEXOS_GATEWAY_PORT`),
  the default browser ports shift to stay in the same “family” (control = gateway + 2).
- `cdpUrl` defaults to `controlUrl + 1` when unset.
- `remoteCdpTimeoutMs` applies to remote (non-loopback) CDP reachability checks.
- `remoteCdpHandshakeTimeoutMs` applies to remote CDP WebSocket reachability checks.
- `attachOnly: true` means “never launch a local browser; only attach if it is already running.”
- `color` + per-profile `color` tint the browser UI so you can see which profile is active.
- Default profile is `chrome` (extension relay). Use `defaultProfile: "clawd"` for the managed browser.
- Auto-detect order: system default browser if Chromium-based; otherwise Chrome → Brave → Edge → Chromium → Chrome Canary.
- Local `clawd` profiles auto-assign `cdpPort`/`cdpUrl` — set those only for remote CDP.

## Use Brave (or another Chromium-based browser)

If your **system default** browser is Chromium-based (Chrome/Brave/Edge/etc),
HexOS uses it automatically. Set `browser.executablePath` to override
auto-detection:

CLI example:

```bash
hexos config set browser.executablePath "/usr/bin/google-chrome"
```

```json5
// macOS
{
  browser: {
    executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  }
}

// Windows
{
  browser: {
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  }
}

// Linux
{
  browser: {
    executablePath: "/usr/bin/brave-browser"
  }
}
```

## Local vs remote control

- **Local control (default):** `controlUrl` is loopback (`127.0.0.1`/`localhost`).
  The Gateway starts the control server and can launch a local browser.
- **Remote control:** `controlUrl` is non-loopback. The Gateway **does not** start
  a local server; it assumes you are pointing at an existing server elsewhere.
- **Remote CDP:** set `browser.profiles.<name>.cdpUrl` (or `browser.cdpUrl`) to
  attach to a remote Chromium-based browser. In this case, HexOS will not launch a local browser.

## Remote browser (control server)

You can run the **browser control server** on another machine and point your
Gateway at it with a remote `controlUrl`. This lets the agent drive a browser
outside the host (lab box, VM, remote desktop, etc.).

Key points:
- The **control server** speaks to Chromium-based browsers (Chrome/Brave/Edge/Chromium) via **CDP**.
- The **Gateway** only needs the HTTP control URL.
- Profiles are resolved on the **control server** side.

Example:
```json5
{
  browser: {
    enabled: true,
    controlUrl: "http://10.0.0.42:18791",
    defaultProfile: "work"
  }
}
```

Use `profiles.<name>.cdpUrl` for **remote CDP** if you want the Gateway to talk
directly to a Chromium-based browser instance without a remote control server.

Remote CDP URLs can include auth:
- Query tokens (e.g., `https://provider.example?token=<token>`)
- HTTP Basic auth (e.g., `https://user:pass@provider.example`)

HexOS preserves the auth when calling `/json/*` endpoints and when connecting
to the CDP WebSocket. Prefer environment variables or secrets managers for
tokens instead of committing them to config files.

### Node browser proxy (zero-config default)

If you run a **node host** on the machine that has your browser, HexOS can
auto-route browser tool calls to that node without any custom `controlUrl`
setup. This is the default path for remote gateways.

Notes:
- The node host exposes its local browser control server via a **proxy command**.
- Profiles come from the node’s own `browser.profiles` config (same as local).
- Disable if you don’t want it:
  - On the node: `nodeHost.browserProxy.enabled=false`
  - On the gateway: `gateway.nodes.browser.mode="off"`

### Browserless (hosted remote CDP)

[Browserless](https://browserless.io) is a hosted Chromium service that exposes
CDP endpoints over HTTPS. You can point a HexOS browser profile at a
Browserless region endpoint and authenticate with your API key.

Example:
```json5
{
  browser: {
    enabled: true,
    defaultProfile: "browserless",
    remoteCdpTimeoutMs: 2000,
    remoteCdpHandshakeTimeoutMs: 4000,
    profiles: {
      browserless: {
        cdpUrl: "https://production-sfo.browserless.io?token=<BROWSERLESS_API_KEY>",
        color: "#00AA00"
      }
    }
  }
}
```

Notes:
- Replace `<BROWSERLESS_API_KEY>` with your real Browserless token.
- Choose the region endpoint that matches your Browserless account (see their docs).

### Running the control server on the browser machine

Run a standalone browser control server (recommended when your Gateway is remote):

```bash
# on the machine that runs Chrome/Brave/Edge
hexos browser serve --bind <browser-host> --port 18791 --token <token>
```

Then point your Gateway at it:

```json5
{
  browser: {
    enabled: true,
    controlUrl: "http://<browser-host>:18791",

    // Option A (recommended): keep token in env on the Gateway
    // (avoid writing secrets into config files)
    // controlToken: "<token>"
  }
}
```

And set the auth token in the Gateway environment:

```bash
export HEXOS_BROWSER_CONTROL_TOKEN="<token>"
```

Option B: store the token in the Gateway config instead (same shared token):

```json5
{
  browser: {
    enabled: true,
    controlUrl: "http://<browser-host>:18791",
    controlToken: "<token>"
  }
}
```

## Security

This section covers the **browser control server** (`browser.controlUrl`) used for agent browser automation.

Key ideas:
- Treat the browser control server like an admin API: **private network only**.
- Use **token auth** always when the server is reachable off-machine.
- Prefer **Tailnet-only** connectivity over LAN exposure.

### Tokens (what is shared with what?)

- `browser.controlToken` / `HEXOS_BROWSER_CONTROL_TOKEN` is **only** for authenticating browser control HTTP requests to `browser.controlUrl`.
- It is **not** the Gateway token (`gateway.auth.token`) and **not** a node pairing token.
- You *can* reuse the same string value, but it’s better to keep them separate to reduce blast radius.

### Binding (don’t expose to your LAN by accident)

Recommended:
- Keep `hexos browser serve` bound to loopback (`127.0.0.1`) and publish it via Tailscale.
- Or bind to a Tailnet IP only (never `0.0.0.0`) and require a token.

Avoid:
- `--bind 0.0.0.0` (LAN-visible). Even with token auth, traffic is plain HTTP unless you also add TLS.

### TLS / HTTPS (recommended approach: terminate in front)

Best practice here: keep `hexos browser serve` on HTTP and terminate TLS in front.

If you’re already using Tailscale, you have two good options:

1) **Tailnet-only, still HTTP** (transport is encrypted by Tailscale):
- Keep `controlUrl` as `http://…` but ensure it’s only reachable over your tailnet.

2) **Serve HTTPS via Tailscale** (nice UX: `https://…` URL):

```bash
# on the browser machine
hexos browser serve --bind 127.0.0.1 --port 18791 --token <token>
tailscale serve https / http://127.0.0.1:18791
```

Then set your Gateway config `browser.controlUrl` to the HTTPS URL (MagicDNS/ts.net) and keep using the same token.

Notes:
- Do **not** use Tailscale Funnel for this unless you explicitly want to make the endpoint public.
- For Tailnet setup/background, see [Gateway web surfaces](/web/index) and the [Gateway CLI](/cli/gateway).

## Profiles (multi-browser)

HexOS supports multiple named profiles (routing configs). Profiles can be:
- **clawd-managed**: a dedicated Chromium-based browser instance with its own user data directory + CDP port
- **remote**: an explicit CDP URL (Chromium-based browser running elsewhere)
- **extension relay**: your existing Chrome tab(s) via the local relay + Chrome extension

Defaults:
- The `clawd` profile is auto-created if missing.
- The `chrome` profile is built-in for the Chrome extension relay (points at `http://127.0.0.1:18792` by default).
- Local CDP ports allocate from **18800–18899** by default.
- Deleting a profile moves its local data directory to Trash.

All control endpoints accept `?profile=<name>`; the CLI uses `--browser-profile`.

## Chrome extension relay (use your existing Chrome)

HexOS can also drive **your existing Chrome tabs** (no separate “clawd” Chrome instance) via a local CDP relay + a Chrome extension.

Full guide: [Chrome extension](/tools/chrome-extension)

Flow:
- You run a **browser control server** (Gateway on the same machine, or `hexos browser serve`).
- A local **relay server** listens at a loopback `cdpUrl` (default: `http://127.0.0.1:18792`).
- You click the **HexOS Browser Relay** extension icon on a tab to attach (it does not auto-attach).
- The agent controls that tab via the normal `browser` tool, by selecting the right profile.

If the Gateway runs on the same machine as Chrome (default setup), you usually **do not** need `hexos browser serve`.
Use `browser serve` only when the Gateway runs elsewhere (remote mode).

### Sandboxed sessions

If the agent session is sandboxed, the `browser` tool may default to `target="sandbox"` (sandbox browser).
Chrome extension relay takeover requires host browser control, so either:
- run the session unsandboxed, or
- set `agents.defaults.sandbox.browser.allowHostControl: true` and use `target="host"` when calling the tool.

### Setup

1) Load the extension (dev/unpacked):

```bash
hexos browser extension install
```

- Chrome → `chrome://extensions` → enable “Developer mode”
- “Load unpacked” → select the directory printed by `hexos browser extension path`
- Pin the extension, then click it on the tab you want to control (badge shows `ON`).

2) Use it:
- CLI: `hexos browser --browser-profile chrome tabs`
- Agent tool: `browser` with `profile="chrome"`

Optional: if you want a different name or relay port, create your own profile:

```bash
hexos browser create-profile \
  --name my-chrome \
  --driver extension \
  --cdp-url http://127.0.0.1:18792 \
  --color "#00AA00"
```

Notes:
- This mode relies on Playwright-on-CDP for most operations (screenshots/snapshots/actions).
- Detach by clicking the extension icon again.

## Isolation guarantees

- **Dedicated user data dir**: never touches your personal browser profile.
- **Dedicated ports**: avoids `9222` to prevent collisions with dev workflows.
- **Deterministic tab control**: target tabs by `targetId`, not “last tab”.

## Browser selection

When launching locally, HexOS picks the first available:
1. Chrome
2. Brave
3. Edge
4. Chromium
5. Chrome Canary

You can override with `browser.executablePath`.

Platforms:
- macOS: checks `/Applications` and `~/Applications`.
- Linux: looks for `google-chrome`, `brave`, `microsoft-edge`, `chromium`, etc.
- Windows: checks common install locations.

## Control API (optional)

If you want to integrate directly, the browser control server exposes a small
HTTP API:

- Status/start/stop: `GET /`, `POST /start`, `POST /stop`
- Tabs: `GET /tabs`, `POST /tabs/open`, `POST /tabs/focus`, `DELETE /tabs/:targetId`
- Snapshot/screenshot: `GET /snapshot`, `POST /screenshot`
- Actions: `POST /navigate`, `POST /act`
- Hooks: `POST /hooks/file-chooser`, `POST /hooks/dialog`
- Downloads: `POST /download`, `POST /wait/download`
- Debugging: `GET /console`, `POST /pdf`
- Debugging: `GET /errors`, `GET /requests`, `POST /trace/start`, `POST /trace/stop`, `POST /highlight`
- Network: `POST /response/body`
- State: `GET /cookies`, `POST /cookies/set`, `POST /cookies/clear`
- State: `GET /storage/:kind`, `POST /storage/:kind/set`, `POST /storage/:kind/clear`
- Settings: `POST /set/offline`, `POST /set/headers`, `POST /set/credentials`, `POST /set/geolocation`, `POST /set/media`, `POST /set/timezone`, `POST /set/locale`, `POST /set/device`

All endpoints accept `?profile=<name>`.

### Playwright requirement

Some features (navigate/act/AI snapshot/role snapshot, element screenshots, PDF) require
Playwright. If Playwright isn’t installed, those endpoints return a clear 501
error. ARIA snapshots and basic screenshots still work for clawd-managed Chrome.
For the Chrome extension relay driver, ARIA snapshots and screenshots require Playwright.

If you see `Playwright is not available in this gateway build`, install the full
Playwright package (not `playwright-core`) and restart the gateway, or reinstall
HexOS with browser support.

## How it works (internal)

High-level flow:
- A small **control server** accepts HTTP requests.
- It connects to Chromium-based browsers (Chrome/Brave/Edge/Chromium) via **CDP**.
- For advanced actions (click/type/snapshot/PDF), it uses **Playwright** on top
  of CDP.
- When Playwright is missing, only non-Playwright operations are available.

This design keeps the agent on a stable, deterministic interface while letting
you swap local/remote browsers and profiles.

## CLI quick reference

All commands accept `--browser-profile <name>` to target a specific profile.
All commands also accept `--json` for machine-readable output (stable payloads).

Basics:
- `hexos browser status`
- `hexos browser start`
- `hexos browser stop`
- `hexos browser tabs`
- `hexos browser tab`
- `hexos browser tab new`
- `hexos browser tab select 2`
- `hexos browser tab close 2`
- `hexos browser open https://example.com`
- `hexos browser focus abcd1234`
- `hexos browser close abcd1234`

Inspection:
- `hexos browser screenshot`
- `hexos browser screenshot --full-page`
- `hexos browser screenshot --ref 12`
- `hexos browser screenshot --ref e12`
- `hexos browser snapshot`
- `hexos browser snapshot --format aria --limit 200`
- `hexos browser snapshot --interactive --compact --depth 6`
- `hexos browser snapshot --efficient`
- `hexos browser snapshot --labels`
- `hexos browser snapshot --selector "#main" --interactive`
- `hexos browser snapshot --frame "iframe#main" --interactive`
- `hexos browser console --level error`
- `hexos browser errors --clear`
- `hexos browser requests --filter api --clear`
- `hexos browser pdf`
- `hexos browser responsebody "**/api" --max-chars 5000`

Actions:
- `hexos browser navigate https://example.com`
- `hexos browser resize 1280 720`
- `hexos browser click 12 --double`
- `hexos browser click e12 --double`
- `hexos browser type 23 "hello" --submit`
- `hexos browser press Enter`
- `hexos browser hover 44`
- `hexos browser scrollintoview e12`
- `hexos browser drag 10 11`
- `hexos browser select 9 OptionA OptionB`
- `hexos browser download e12 /tmp/report.pdf`
- `hexos browser waitfordownload /tmp/report.pdf`
- `hexos browser upload /tmp/file.pdf`
- `hexos browser fill --fields '[{"ref":"1","type":"text","value":"Ada"}]'`
- `hexos browser dialog --accept`
- `hexos browser wait --text "Done"`
- `hexos browser wait "#main" --url "**/dash" --load networkidle --fn "window.ready===true"`
- `hexos browser evaluate --fn '(el) => el.textContent' --ref 7`
- `hexos browser highlight e12`
- `hexos browser trace start`
- `hexos browser trace stop`

State:
- `hexos browser cookies`
- `hexos browser cookies set session abc123 --url "https://example.com"`
- `hexos browser cookies clear`
- `hexos browser storage local get`
- `hexos browser storage local set theme dark`
- `hexos browser storage session clear`
- `hexos browser set offline on`
- `hexos browser set headers --json '{"X-Debug":"1"}'`
- `hexos browser set credentials user pass`
- `hexos browser set credentials --clear`
- `hexos browser set geo 37.7749 -122.4194 --origin "https://example.com"`
- `hexos browser set geo --clear`
- `hexos browser set media dark`
- `hexos browser set timezone America/New_York`
- `hexos browser set locale en-US`
- `hexos browser set device "iPhone 14"`

Notes:
- `upload` and `dialog` are **arming** calls; run them before the click/press
  that triggers the chooser/dialog.
- `upload` can also set file inputs directly via `--input-ref` or `--element`.
- `snapshot`:
  - `--format ai` (default when Playwright is installed): returns an AI snapshot with numeric refs (`aria-ref="<n>"`).
  - `--format aria`: returns the accessibility tree (no refs; inspection only).
  - `--efficient` (or `--mode efficient`): compact role snapshot preset (interactive + compact + depth + lower maxChars).
  - Config default (tool/CLI only): set `browser.snapshotDefaults.mode: "efficient"` to use efficient snapshots when the caller does not pass a mode (see [Gateway configuration](/gateway/configuration#browser-clawd-managed-browser)).
  - Role snapshot options (`--interactive`, `--compact`, `--depth`, `--selector`) force a role-based snapshot with refs like `ref=e12`.
  - `--frame "<iframe selector>"` scopes role snapshots to an iframe (pairs with role refs like `e12`).
  - `--interactive` outputs a flat, easy-to-pick list of interactive elements (best for driving actions).
  - `--labels` adds a viewport-only screenshot with overlayed ref labels (prints `MEDIA:<path>`).
- `click`/`type`/etc require a `ref` from `snapshot` (either numeric `12` or role ref `e12`).
  CSS selectors are intentionally not supported for actions.

## Snapshots and refs

HexOS supports two “snapshot” styles:

- **AI snapshot (numeric refs)**: `hexos browser snapshot` (default; `--format ai`)
  - Output: a text snapshot that includes numeric refs.
  - Actions: `hexos browser click 12`, `hexos browser type 23 "hello"`.
  - Internally, the ref is resolved via Playwright’s `aria-ref`.

- **Role snapshot (role refs like `e12`)**: `hexos browser snapshot --interactive` (or `--compact`, `--depth`, `--selector`, `--frame`)
  - Output: a role-based list/tree with `[ref=e12]` (and optional `[nth=1]`).
  - Actions: `hexos browser click e12`, `hexos browser highlight e12`.
  - Internally, the ref is resolved via `getByRole(...)` (plus `nth()` for duplicates).
  - Add `--labels` to include a viewport screenshot with overlayed `e12` labels.

Ref behavior:
- Refs are **not stable across navigations**; if something fails, re-run `snapshot` and use a fresh ref.
- If the role snapshot was taken with `--frame`, role refs are scoped to that iframe until the next role snapshot.

## Wait power-ups

You can wait on more than just time/text:

- Wait for URL (globs supported by Playwright):
  - `hexos browser wait --url "**/dash"`
- Wait for load state:
  - `hexos browser wait --load networkidle`
- Wait for a JS predicate:
  - `hexos browser wait --fn "window.ready===true"`
- Wait for a selector to become visible:
  - `hexos browser wait "#main"`

These can be combined:

```bash
hexos browser wait "#main" \
  --url "**/dash" \
  --load networkidle \
  --fn "window.ready===true" \
  --timeout-ms 15000
```

## Debug workflows

When an action fails (e.g. “not visible”, “strict mode violation”, “covered”):

1. `hexos browser snapshot --interactive`
2. Use `click <ref>` / `type <ref>` (prefer role refs in interactive mode)
3. If it still fails: `hexos browser highlight <ref>` to see what Playwright is targeting
4. If the page behaves oddly:
   - `hexos browser errors --clear`
   - `hexos browser requests --filter api --clear`
5. For deep debugging: record a trace:
   - `hexos browser trace start`
   - reproduce the issue
   - `hexos browser trace stop` (prints `TRACE:<path>`)

## JSON output

`--json` is for scripting and structured tooling.

Examples:

```bash
hexos browser status --json
hexos browser snapshot --interactive --json
hexos browser requests --filter api --json
hexos browser cookies --json
```

Role snapshots in JSON include `refs` plus a small `stats` block (lines/chars/refs/interactive) so tools can reason about payload size and density.

## State and environment knobs

These are useful for “make the site behave like X” workflows:

- Cookies: `cookies`, `cookies set`, `cookies clear`
- Storage: `storage local|session get|set|clear`
- Offline: `set offline on|off`
- Headers: `set headers --json '{"X-Debug":"1"}'` (or `--clear`)
- HTTP basic auth: `set credentials user pass` (or `--clear`)
- Geolocation: `set geo <lat> <lon> --origin "https://example.com"` (or `--clear`)
- Media: `set media dark|light|no-preference|none`
- Timezone / locale: `set timezone ...`, `set locale ...`
- Device / viewport:
  - `set device "iPhone 14"` (Playwright device presets)
  - `set viewport 1280 720`

## Security & privacy

- The clawd browser profile may contain logged-in sessions; treat it as sensitive.
- For logins and anti-bot notes (X/Twitter, etc.), see [Browser login + X/Twitter posting](/tools/browser-login).
- Keep control URLs loopback-only unless you intentionally expose the server.
- Remote CDP endpoints are powerful; tunnel and protect them.

## Troubleshooting

For Linux-specific issues (especially snap Chromium), see
[Browser troubleshooting](/tools/browser-linux-troubleshooting).

## Agent tools + how control works

The agent gets **one tool** for browser automation:
- `browser` — status/start/stop/tabs/open/focus/close/snapshot/screenshot/navigate/act

How it maps:
- `browser snapshot` returns a stable UI tree (AI or ARIA).
- `browser act` uses the snapshot `ref` IDs to click/type/drag/select.
- `browser screenshot` captures pixels (full page or element).
- `browser` accepts:
  - `profile` to choose a named browser profile (host or remote control server).
  - `target` (`sandbox` | `host` | `custom`) to select where the browser lives.
  - `controlUrl` sets `target: "custom"` implicitly (remote control server).
  - In sandboxed sessions, `target: "host"` requires `agents.defaults.sandbox.browser.allowHostControl=true`.
  - If `target` is omitted: sandboxed sessions default to `sandbox`, non-sandbox sessions default to `host`.
  - Sandbox allowlists can restrict `target: "custom"` to specific URLs/hosts/ports.
  - Defaults: allowlists unset (no restriction), and sandbox host control is disabled.

This keeps the agent deterministic and avoids brittle selectors.
