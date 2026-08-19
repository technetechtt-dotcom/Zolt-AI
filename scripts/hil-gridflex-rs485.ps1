param(
  [Parameter(Mandatory=$true)][string]$PortName,
  [string]$Profile = "connectors/gridflex/profiles/industrial-emulator-v1.json",
  [string]$Report = "docs/operations/hil-gridflex-result.json"
)
$ErrorActionPreference = "Stop"

function Get-ModbusCrc([byte[]]$Data) {
  [uint16]$crc = 0xffff
  foreach ($value in $Data) {
    $crc = $crc -bxor $value
    for ($bit = 0; $bit -lt 8; $bit++) {
      if (($crc -band 1) -ne 0) { $crc = (($crc -shr 1) -bxor 0xa001) } else { $crc = $crc -shr 1 }
    }
  }
  return $crc
}

$configuration = Get-Content -LiteralPath $Profile -Raw | ConvertFrom-Json
$serial = [System.IO.Ports.SerialPort]::new($PortName, [int]$configuration.baudRate, [System.IO.Ports.Parity]::$($configuration.parity), [int]$configuration.dataBits, [System.IO.Ports.StopBits]::$($configuration.stopBits))
$serial.ReadTimeout = 2000
$serial.WriteTimeout = 2000
$results = @()
$serial.Open()
try {
  foreach ($register in $configuration.registers) {
    $count = if ($register.dataType -match '32') { 2 } else { 1 }
    [byte[]]$request = @([byte]$configuration.slaveId, 3, [byte]($register.address -shr 8), [byte]($register.address -band 255), 0, [byte]$count)
    $crc = Get-ModbusCrc $request
    [byte[]]$frame = $request + @([byte]($crc -band 255), [byte]($crc -shr 8))
    $serial.DiscardInBuffer()
    $serial.Write($frame, 0, $frame.Length)
    [byte[]]$response = New-Object byte[] (5 + 2 * $count)
    $read = 0
    while ($read -lt $response.Length) { $read += $serial.Read($response, $read, $response.Length - $read) }
    if ($response[1] -ne 3) { throw "Modbus exception or unexpected function for register $($register.address)" }
    $expectedCrc = Get-ModbusCrc $response[0..($response.Length - 3)]
    $receivedCrc = [uint16]($response[-2] + ($response[-1] -shl 8))
    if ($expectedCrc -ne $receivedCrc) { throw "CRC failure for register $($register.address)" }
    [uint32]$raw = if ($count -eq 1) { ($response[3] -shl 8) + $response[4] } else { ($response[3] -shl 24) + ($response[4] -shl 16) + ($response[5] -shl 8) + $response[6] }
    if ($register.wordOrder -eq "little" -and $count -eq 2) { $raw = (($raw -band 0xffff) -shl 16) + ($raw -shr 16) }
    [int64]$signed = $raw
    if ($register.dataType -eq "int16" -and $raw -ge 0x8000) { $signed = $raw - 0x10000 }
    if ($register.dataType -eq "int32" -and $raw -ge 0x80000000) { $signed = $raw - 0x100000000 }
    $results += [ordered]@{ address=$register.address; key=$register.key; value=([double]$signed * [double]$register.scale); unit=$register.unit; crc="PASS"; receivedAt=(Get-Date).ToUniversalTime().ToString("o") }
  }
} finally {
  $serial.Close()
}
$result = [ordered]@{ executedAt=(Get-Date).ToUniversalTime().ToString("o"); port=$PortName; physicalRs485=$true; readOnlyFunctionCode=3; plantControlEnabled=$false; profile=$configuration; readings=$results; result="PASS" }
$directory = Split-Path -Parent $Report
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Report -Encoding utf8
$result | ConvertTo-Json -Depth 10
