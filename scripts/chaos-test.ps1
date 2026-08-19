param(
  [ValidateSet("redis", "postgres")][string]$Target,
  [int]$OutageSeconds = 15,
  [string]$Report = "docs/operations/chaos-result.json"
)
$ErrorActionPreference = "Stop"
if ($OutageSeconds -lt 1 -or $OutageSeconds -gt 300) { throw "OutageSeconds must be between 1 and 300" }
$service = $Target
$started = Get-Date
docker compose stop $service
try {
  Start-Sleep -Seconds $OutageSeconds
} finally {
  docker compose start $service
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4000/health/ready" -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
$finished = Get-Date
$result = [ordered]@{ executedAt=$finished.ToUniversalTime().ToString("o"); target=$Target; outageSeconds=$OutageSeconds; recovered=$ready; recoverySeconds=[Math]::Round(($finished-$started).TotalSeconds-$OutageSeconds,2) }
$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json
if (-not $ready) { exit 1 }
