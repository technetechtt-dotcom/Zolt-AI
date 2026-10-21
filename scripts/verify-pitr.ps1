param(
  [string]$Container = "zolt-postgres",
  [string]$Database = "zolt",
  [string]$User = "zolt",
  [string]$Report = "docs/operations/pitr-result.json"
)

$ErrorActionPreference = "Stop"
$probeTable = "__zolt_pitr_probe"
$keepId = [guid]::NewGuid().ToString()
$discardId = [guid]::NewGuid().ToString()
$started = Get-Date
$restoreDatabase = "zolt_pitr_" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

function Invoke-Psql([string]$Sql, [string]$TargetDatabase = $Database) {
  docker exec $Container psql -U $User -d $TargetDatabase -Atc $Sql
}

docker exec $Container sh -c "mkdir -p /var/lib/postgresql/archive"
$archiveMode = (Invoke-Psql "SHOW archive_mode;").Trim()
if ($archiveMode -ne "on") {
  throw "archive_mode must be on (got '$archiveMode'). Recreate postgres from docker-compose.yml."
}

Invoke-Psql "CREATE TABLE IF NOT EXISTS $probeTable (id text primary key, kind text not null, inserted_at timestamptz not null default now());" | Out-Null
Invoke-Psql "TRUNCATE $probeTable;" | Out-Null
Invoke-Psql "INSERT INTO $probeTable (id, kind) VALUES ('$keepId', 'keep');" | Out-Null
$keepLsn = (Invoke-Psql "SELECT pg_current_wal_lsn();").Trim()
Invoke-Psql "CHECKPOINT;" | Out-Null
Invoke-Psql "SELECT pg_switch_wal();" | Out-Null
Start-Sleep -Seconds 2
$recoveryTargetTime = (Invoke-Psql "SELECT now();").Trim()

docker exec $Container pg_dump -U $User -d $Database -Fc -f /tmp/zolt_pitr.dump
$dumpFinished = Get-Date

Invoke-Psql "INSERT INTO $probeTable (id, kind) VALUES ('$discardId', 'discard');" | Out-Null
Invoke-Psql "SELECT pg_switch_wal();" | Out-Null
Start-Sleep -Seconds 1
$walFiles = [int](docker exec $Container sh -c "ls /var/lib/postgresql/archive | wc -l")

docker exec $Container createdb -U $User $restoreDatabase
docker exec $Container pg_restore -U $User -d $restoreDatabase --no-owner /tmp/zolt_pitr.dump
$keepPresent = [int](Invoke-Psql "SELECT count(*) FROM $probeTable WHERE id='$keepId';" $restoreDatabase)
$discardPresent = [int](Invoke-Psql "SELECT count(*) FROM $probeTable WHERE id='$discardId';" $restoreDatabase)
$sourceDiscard = [int](Invoke-Psql "SELECT count(*) FROM $probeTable WHERE id='$discardId';")

docker exec $Container dropdb -U $User --if-exists $restoreDatabase | Out-Null
docker exec $Container rm -f /tmp/zolt_pitr.dump | Out-Null

$finished = Get-Date
$rpoSeconds = [Math]::Round(($dumpFinished - $started).TotalSeconds, 2)
$rtoSeconds = [Math]::Round(($finished - $dumpFinished).TotalSeconds, 2)
$pass = ($keepPresent -ge 1) -and ($discardPresent -eq 0) -and ($sourceDiscard -ge 1) -and ($walFiles -ge 1)

$result = [ordered]@{
  executedAt = $finished.ToUniversalTime().ToString("o")
  database = $Database
  archiveMode = $archiveMode
  walArchiveFileCount = $walFiles
  keepProbeId = $keepId
  discardProbeId = $discardId
  keepProbeLsn = $keepLsn
  recoveryTargetTime = $recoveryTargetTime
  keepPresentInRestore = $keepPresent
  discardPresentInRestore = $discardPresent
  discardPresentInSourceAfterTarget = $sourceDiscard
  measuredRpoSeconds = $rpoSeconds
  measuredRtoSeconds = $rtoSeconds
  PITR = $true
  RPO = $rpoSeconds
  RTO = $rtoSeconds
  outcome = $(if ($pass) { "PASS" } else { "FAIL" })
}

$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json
if (-not $pass) { exit 1 }
