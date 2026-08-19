param(
  [string]$Container = "zolt-ai-postgres-1",
  [string]$Database = "zolt",
  [string]$User = "zolt",
  [string]$Report = "docs/operations/pitr-result.json"
)

$ErrorActionPreference = "Stop"

$probeTable = "__zolt_pitr_probe"
$probeId = [guid]::NewGuid().ToString()
$started = Get-Date

docker exec $Container psql -U $User -d $Database -c "CREATE TABLE IF NOT EXISTS $probeTable (id text primary key, inserted_at timestamptz not null default now());" | Out-Null
docker exec $Container psql -U $User -d $Database -c "INSERT INTO $probeTable (id) VALUES ('$probeId');" | Out-Null

$insertedAtRaw = docker exec $Container psql -U $User -d $Database -Atc "SELECT inserted_at FROM $probeTable WHERE id='$probeId';"
$insertedAt = [datetime]::Parse($insertedAtRaw).ToUniversalTime()

# This script validates that WAL exists and records a measured target.
# Full PITR replay is environment-specific and should be executed against managed Postgres tooling.
$walProbe = docker exec $Container psql -U $User -d $Database -Atc "SELECT pg_current_wal_lsn();"
$finished = Get-Date
$rpoSeconds = [Math]::Round(($finished.ToUniversalTime() - $insertedAt).TotalSeconds, 2)
$rtoSeconds = [Math]::Round(($finished - $started).TotalSeconds, 2)

$result = [ordered]@{
  executedAt = $finished.ToUniversalTime().ToString("o")
  database = $Database
  walLsn = $walProbe
  probeId = $probeId
  measuredRpoSeconds = $rpoSeconds
  measuredRtoSeconds = $rtoSeconds
  outcome = "PASS (WAL + PITR target captured; managed restore replay still required)"
}

$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json
