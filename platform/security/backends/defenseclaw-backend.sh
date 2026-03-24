#!/usr/bin/env bash
# HexOS Phase 1.5 — DefenseClaw Backend (Stub)
# Will wrap Cisco DefenseClaw when available (github.com/cisco/defenseclaw)
# For now: falls back to builtin scanner
set -uo pipefail

echo "Warning: DefenseClaw not available — using builtin scanner" >&2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/builtin-scanner.sh" "$@"
