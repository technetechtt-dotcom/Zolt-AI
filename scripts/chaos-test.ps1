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
$entry = [ordered]@{
  executedAt = $finished.ToUniversalTime().ToString("o")
  target = $Target
  outageSeconds = $OutageSeconds
  recovered = $ready
  recoverySeconds = [Math]::Round(($finished - $started).TotalSeconds - $OutageSeconds, 2)
}
$runs = @()
if (Test-Path -LiteralPath $Report) {
  try {
    $previous = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
    if ($previous.runs) {
      $runs = @($previous.runs | Where-Object { $_.target -and $_.recovered -ne $null })
    } elseif ($previous.target -and $previous.result -ne "NOT_EXECUTED") {
      $runs = @($previous)
    }
  } catch {}
}
$runs = @($runs | Where-Object { $_.target -ne $Target }) + $entry
$allRecovered = -not ($runs | Where-Object { -not $_.recovered })
$result = [ordered]@{
  executedAt = $entry.executedAt
  result = $(if ($allRecovered) { "PASS" } else { "FAIL" })
  runs = $runs
}
$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json -Depth 6
if (-not $ready) { exit 1 }
