#!/usr/bin/env bash
# Starts Doppel (production build) and its hand control (tkt/) for the demo (macOS / Linux).
# Usage: scripts/demo-with-tkt.sh ; env: PORT (3000), TKT_BACKEND (native on macOS, else pynput), TKT_MODE (auto|a)
# Stops only the Doppel server it started (by PID). The hand control runs in the foreground; quit it with Esc or Ctrl+C.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tkt="${TKT_DIR:-$root/tkt}"
port="${PORT:-3000}"
backend="${TKT_BACKEND:-$([ "$(uname)" = "Darwin" ] && echo native || echo pynput)}"
[ -f "$tkt/pyproject.toml" ] || { echo "Hand control not found in '$tkt'. Clone with --recurse-submodules (or run 'git submodule update --init')." >&2; exit 1; }

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
  # macOS: the auto mode switches between the desk camera (A) and the pinch setup (C).
  echo "Hand control: auto mode (A/C). Esc quits."
  uv run python -m tkt.app.auto_mode
else
  echo "Hand control: version A ($backend). Calibrate with 'uv run python -m tkt.vision.debug_view' first if needed."
  uv run python -m tkt.app.main --source live --backend "$backend" --hud
fi
