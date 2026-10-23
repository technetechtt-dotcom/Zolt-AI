param(
  [ValidateSet("redis", "postgres")][string]$Target,
  [int]$OutageSeconds = 15,
  [int]$RecoveryBudgetSeconds = 60,
  [string]$Report = "docs/operations/chaos-result.json"
)
$ErrorActionPreference = "Stop"
if ($OutageSeconds -lt 1 -or $OutageSeconds -gt 300) { throw "OutageSeconds must be between 1 and 300" }
if ($RecoveryBudgetSeconds -lt 15 -or $RecoveryBudgetSeconds -gt 120) { throw "RecoveryBudgetSeconds must be between 15 and 120" }
$dockerDir = Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin"
if (Test-Path $dockerDir) { $env:Path = "$dockerDir;$env:Path" }
$container = if ($Target -eq "redis") { "zolt-redis" } else { "zolt-postgres" }

function Probe-Ready([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-Json([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 5
  } catch {
    return $null
  }
}

$apiKey = $env:ZOLT_API_KEY
if (-not $apiKey) { $apiKey = "dev-api-key-change-me" }
$headers = @{ "x-zolt-api-key" = $apiKey; "x-zolt-tenant-id" = "tenant-demo" }
$recsBefore = @()
try {
  $recsBefore = @(Invoke-RestMethod -Uri "http://localhost:4000/v1/recommendations?tenantId=tenant-demo" -Headers $headers -TimeoutSec 5)
} catch { $recsBefore = @() }
$survived = $false
$duplicates = 0
$messageId = "chaos-survive-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
if ($Target -eq "redis") {
  try {
    $now = (Get-Date).ToUniversalTime().ToString("o")
    $body = @{
      schemaVersion = "1.0"
      tenantId = "tenant-demo"
      productId = "product-demo"
      installationId = "installation-demo"
      deviceId = "chaos-device"
      messageId = $messageId
      sourceTimestamp = $now
      receivedTimestamp = $now
      simulated = $true
      measurements = @(@{ key = "powerKw"; value = 12.5; quality = "GOOD" })
    } | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri "http://localhost:4000/v1/telemetry" -Method POST -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 8 | Out-Null
  } catch {}
}

$started = Get-Date
docker stop $container | Out-Null
try {
  Start-Sleep -Seconds $OutageSeconds
} finally {
  docker start $container | Out-Null
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if ($Target -eq "redis") {
    $pong = docker exec $container redis-cli ping 2>$null
    if (("$pong").Trim() -eq "PONG") { break }
  } else {
    $pg = docker exec $container pg_isready -U zolt -d zolt 2>$null
    if ("$pg" -match "accepting") { break }
  }
  Start-Sleep -Seconds 2
}

$apiReady = $false
$gatewayReady = $false
$workerReady = $false
$deadline = (Get-Date).AddSeconds($RecoveryBudgetSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not $apiReady) { $apiReady = Probe-Ready "http://localhost:4000/health/ready" }
  if (-not $gatewayReady) { $gatewayReady = Probe-Ready "http://localhost:4001/health/ready" }
  if (-not $workerReady) { $workerReady = Probe-Ready "http://localhost:4003/health/ready" }
  if ($apiReady -and $gatewayReady -and $workerReady) { break }
  Start-Sleep -Seconds 2
}
$finished = Get-Date
$ready = $apiReady -and $gatewayReady -and $workerReady

if ($ready -and $Target -eq "redis") {
  Start-Sleep -Seconds 3
  try {
    $rows = @(Invoke-RestMethod -Uri "http://localhost:4000/v1/telemetry?tenantId=tenant-demo&productId=product-demo&installationId=installation-demo" -Headers $headers -TimeoutSec 8)
    $survived = [bool]($rows | Where-Object { $_.messageId -eq $messageId })
  } catch { $survived = $false }
}

try {
  $recsAfter = Invoke-RestMethod -Uri "http://localhost:4000/v1/recommendations?tenantId=tenant-demo" -Headers $headers -TimeoutSec 5
  if ($null -eq $recsAfter) { $recsAfter = @() }
  if ($recsAfter -isnot [System.Array]) { $recsAfter = @($recsAfter) }
  $afterIds = @($recsAfter | ForEach-Object { $_.id } | Where-Object { $_ })
  $duplicates = @(
    $afterIds | Group-Object | Where-Object { $_.Count -gt 1 }
  ).Count
} catch {}

$entry = [ordered]@{
  executedAt = $finished.ToUniversalTime().ToString("o")
  target = $Target
  outageSeconds = $OutageSeconds
  recoveryBudgetSeconds = $RecoveryBudgetSeconds
  recovered = $ready
  apiReady = $apiReady
  gatewayReady = $gatewayReady
  workerReady = $workerReady
  queuedTelemetrySurvived = $(if ($Target -eq "redis") { $survived } else { $null })
  duplicateRecommendations = $duplicates
  recoverySeconds = [Math]::Round(($finished - $started).TotalSeconds - $OutageSeconds, 2)
  operatorRestart = $false
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
$budgetOk = -not ($runs | Where-Object { $_.recoverySeconds -gt $RecoveryBudgetSeconds })
$dupOk = -not ($runs | Where-Object { $_.duplicateRecommendations -gt 0 })
$result = [ordered]@{
  executedAt = $entry.executedAt
  result = $(if ($allRecovered -and $budgetOk -and $dupOk) { "PASS" } else { "FAIL" })
  recoveryBudgetSeconds = $RecoveryBudgetSeconds
  runs = $runs
}
$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json -Depth 6
if ($result.result -ne "PASS") { exit 1 }
