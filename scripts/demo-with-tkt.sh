#!/usr/bin/env bash
# Starts Doppel (production build) and TKT's live touchpad side by side for the demo (macOS / Linux).
# Usage: scripts/demo-with-tkt.sh [TKT_DIR] ; env: PORT (3000), TKT_BACKEND (native on macOS, else pynput)
# Stops only the Doppel server it started (by PID). TKT runs in the foreground; quit it with its own keys or Ctrl+C.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# Default: the submodule in this repository (git submodule update --init), else a sibling checkout ../TKT.
default_tkt="$root/tkt"
[ -f "$default_tkt/pyproject.toml" ] || default_tkt="$(dirname "$root")/TKT"
tkt="${1:-${TKT_DIR:-$default_tkt}}"
port="${PORT:-3000}"
backend="${TKT_BACKEND:-$([ "$(uname)" = "Darwin" ] && echo native || echo pynput)}"
[ -f "$tkt/pyproject.toml" ] || { echo "TKT not found at '$tkt'. Run 'git submodule update --init', pass it as the first argument or set TKT_DIR." >&2; exit 1; }

cd "$root"
[ -f .next/BUILD_ID ] || npm run build
node node_modules/next/dist/bin/next start -p "$port" >/dev/null 2>&1 &
doppel=$!
trap 'kill "$doppel" 2>/dev/null && echo "Stopped Doppel (PID $doppel)."' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null "http://localhost:$port/play" && break; sleep 0.5; done
echo "Doppel: http://localhost:$port/play (PID $doppel)"
(command -v open >/dev/null && open "http://localhost:$port/play") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$port/play") || true

cd "$tkt"
if [ "$(uname)" = "Darwin" ] && [ "${TKT_MODE:-auto}" = "auto" ]; then
  # macOS: TKT's auto mode switches between the desk camera (A) and the pinch setup (C).
  echo "TKT: auto mode (A/C). Esc quits."
  uv run python -m tkt.app.auto_mode
else
  echo "TKT: version A, live touchpad ($backend). Calibrate with 'uv run python -m tkt.vision.debug_view' first if needed."
  uv run python -m tkt.app.main --source live --backend "$backend" --hud
fi
