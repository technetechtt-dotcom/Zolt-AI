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
$accepted = $false
$rejected = 0
$messageId = "chaos-survive-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
if ($Target -eq "redis") {
  try {
    docker exec zolt-redis redis-cli CONFIG SET appendfsync always | Out-Null
    $hmac = $env:ZOLT_INGEST_HMAC_SECRET
    if (-not $hmac) { $hmac = "dev-hmac-secret-change-me" }
    $nowIso = (Get-Date).ToUniversalTime().ToString("o")
    $payload = @{
      messageId = $messageId
      nodeId = "chaos-device"
      timestamp = $nowIso
      sequence = 1
      simulated = $true
      vendor = "chaos"
      model = "probe"
      communicationHealth = "HEALTHY"
      readings = @{ powerKw = 12.5; voltage = 400; frequencyHz = 50 }
    } | ConvertTo-Json -Compress -Depth 6
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $replayKey = [guid]::NewGuid().ToString()
    $toSign = "$timestamp.$replayKey.$payload"
    $hmacsha = New-Object System.Security.Cryptography.HMACSHA256
    $hmacsha.Key = [Text.Encoding]::UTF8.GetBytes($hmac)
    $hash = $hmacsha.ComputeHash([Text.Encoding]::UTF8.GetBytes($toSign))
    $signature = ([BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()
    $ingestHeaders = @{
      "x-zolt-api-key" = $apiKey
      "x-zolt-tenant-id" = "tenant-demo"
      "x-zolt-product-id" = "product-demo"
      "x-zolt-installation-id" = "installation-demo"
      "x-zolt-signature-ts" = $timestamp
      "x-zolt-replay-key" = $replayKey
      "x-zolt-signature" = $signature
      "x-zolt-load-harness" = "true"
    }
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4001/v1/ingest/gridflex" -Method POST -Headers $ingestHeaders -ContentType "application/json" -Body $payload -TimeoutSec 8
    $accepted = $response.StatusCode -eq 202
    docker exec zolt-redis redis-cli BGREWRITEAOF | Out-Null
    Start-Sleep -Seconds 2
  } catch {
    $accepted = $false
  }
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
  $deadlineSurvive = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadlineSurvive) {
    try {
      $rows = @(Invoke-RestMethod -Uri "http://localhost:4000/v1/telemetry?tenantId=tenant-demo&productId=product-demo&installationId=installation-demo&messageId=$messageId" -Headers $headers -TimeoutSec 8)
      $survived = [bool]($rows | Where-Object { $_.messageId -eq $messageId })
      if ($survived) { break }
    } catch { $survived = $false }
    Start-Sleep -Seconds 2
  }
  if (-not $accepted) { $rejected = 1 }
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
  acceptedBeforeOutage = $(if ($Target -eq "redis") { $accepted } else { $null })
  rejectedExplicitly = $(if ($Target -eq "redis") { $rejected } else { $null })
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
$queueOk = -not ($runs | Where-Object { $_.target -eq "redis" -and $_.queuedTelemetrySurvived -ne $true })
$operatorOk = -not ($runs | Where-Object { $_.operatorRestart -eq $true })
$result = [ordered]@{
  executedAt = $entry.executedAt
  result = $(if ($allRecovered -and $budgetOk -and $dupOk -and $queueOk -and $operatorOk) { "PASS" } else { "FAIL" })
  recoveryBudgetSeconds = $RecoveryBudgetSeconds
  runs = $runs
}
$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json -Depth 6
if ($result.result -ne "PASS") { exit 1 }
