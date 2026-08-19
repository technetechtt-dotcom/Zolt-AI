param(
  [string]$Container = "zolt-ai-postgres-1",
  [string]$Database = "zolt",
  [string]$User = "zolt",
  [string]$Report = "docs/operations/backup-restore-result.json"
)
$ErrorActionPreference = "Stop"
$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$restoreDatabase = "zolt_restore_$suffix"
if ($restoreDatabase -notmatch '^zolt_restore_[0-9]+$') { throw "Unsafe restore database name" }
$dumpPath = Join-Path ([System.IO.Path]::GetTempPath()) "$restoreDatabase.dump"
$started = Get-Date
try {
  docker exec $Container pg_dump -U $User -d $Database -Fc -f "/tmp/$restoreDatabase.dump"
  docker cp "${Container}:/tmp/$restoreDatabase.dump" $dumpPath
  docker exec $Container createdb -U $User $restoreDatabase
  docker cp $dumpPath "${Container}:/tmp/$restoreDatabase.dump"
  docker exec $Container pg_restore -U $User -d $restoreDatabase --no-owner "/tmp/$restoreDatabase.dump"
  $counts = docker exec $Container psql -U $User -d $restoreDatabase -Atc 'SELECT count(*) FROM "Tenant";'
  $finished = Get-Date
  $result = [ordered]@{
    executedAt = $finished.ToUniversalTime().ToString("o")
    sourceDatabase = $Database
    restoreDatabase = $restoreDatabase
    result = "PASS"
    tenantCount = [int]$counts
    recoveryTimeSeconds = [Math]::Round(($finished - $started).TotalSeconds, 2)
    recoveryPoint = "logical dump start"
  }
  $directory = Split-Path -Parent $Report
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding utf8
  $result | ConvertTo-Json
} finally {
  docker exec $Container dropdb -U $User --if-exists $restoreDatabase | Out-Null
  docker exec $Container rm -f "/tmp/$restoreDatabase.dump" | Out-Null
  if (Test-Path -LiteralPath $dumpPath) { Remove-Item -LiteralPath $dumpPath -Force }
}
