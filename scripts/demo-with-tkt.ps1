# Starts Doppel (production build) and TKT's live touchpad side by side for the demo (Windows).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/demo-with-tkt.ps1 [-TktDir D:\Lauzhack26\TKT] [-Port 3000] [-Backend pynput]
# Stops only the Doppel server it started (by PID). TKT runs in the foreground; quit it with its own keys or Ctrl+C.
param(
  [string]$TktDir = $env:TKT_DIR,
  [int]$Port = 3000,
  [string]$Backend = "pynput"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $TktDir) { $TktDir = Join-Path (Split-Path -Parent $root) "TKT" }
if (-not (Test-Path (Join-Path $TktDir "pyproject.toml"))) { throw "TKT not found at '$TktDir'. Pass -TktDir or set TKT_DIR." }

Push-Location $root
try {
  if (-not (Test-Path ".next\BUILD_ID")) { npm run build }
  $doppel = Start-Process -FilePath "node" -ArgumentList @("node_modules/next/dist/bin/next", "start", "-p", "$Port") -PassThru -WindowStyle Hidden
  Write-Host "Doppel: http://localhost:$Port/play (PID $($doppel.Id))"
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/play" -TimeoutSec 2).StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 500 }
  }
  Start-Process "http://localhost:$Port/play"
} finally {
  Pop-Location
}

Push-Location $TktDir
try {
  Write-Host "TKT: live touchpad ($Backend). Calibrate with 'uv run python -m tkt.vision.debug_view' first if needed."
  uv run python -m tkt.app.main --source live --backend $Backend
} finally {
  Pop-Location
  if ($doppel -and -not $doppel.HasExited) { Stop-Process -Id $doppel.Id }
  Write-Host "Stopped Doppel (PID $($doppel.Id))."
}
