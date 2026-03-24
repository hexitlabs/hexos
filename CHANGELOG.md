# HexOS Changelog

All notable changes to HexOS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [v0.1.1] - 2026-03-24

### Security
- Exec approval bypass fix — `time` wrapper unwrapping (12 wrapper commands, 4-level recursion)
- Exec env var hardening — expanded blocklist from 6 to 30 dangerous env vars
- Credential stripping from diagnostic cache-trace output

### Notes
- Memory regression patch (upstream 2026.3.13) determined N/A — HexOS uses tsc compilation, not Rollup/Vite bundling

## [v0.1.0] - 2026-01-24

### Initial Release
- Forked from Clawdbot 2026.1.24-3
- Rebranded to HexOS (@hexitlabs/hexos)
- NVIDIA NIM as default model provider
- Lightpanda skill integration
- /effort command
- Recall + Vigil bundled plugins
- Setup wizard
- 42 HexOS-specific commits
