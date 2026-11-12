# A heart rate strap played by this laptop (ROADMAP Stage 5 item 37f-i), for the phone's walk when no real
# strap or watch is at hand. Windows' own Bluetooth serves the standard Heart Rate service (0x180D) and sends
# its measurement (0x2A37) once a second in a real Polar H10's shape: flags 0x16 (skin felt, beat times
# follow), the beat rate, one beat time. Nothing to install: Windows PowerShell 5.1 and the laptop's
# Bluetooth, switched on (Settings > Bluetooth & devices), its radio able to serve (checked 2026-11-12 on
# this laptop's Intel Wireless Bluetooth: IsPeripheralRoleSupported True).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/mobile/tools/fake-heart-strap.ps1 [-Plan run|steady] [-Seconds 600]
#
# run (the default): two minutes rising from 95 to 150, then 150 to 165; at each fifth minute 10 s with no
# skin under the strap (flags 0x04), then 20 s of nothing at all, as a strap taken off or out of reach. The
# phone must show No signal for both, never a number, and connect again by itself. steady: 120 throughout.
# Ctrl+C stops it; the laptop's Bluetooth is left as it was.
param(
  [ValidateSet("run", "steady")] [string]$Plan = "run",
  [int]$Seconds = 600
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IBuffer, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskOf = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, [Type]$resultType) {
  $task = $asTaskOf.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(10000)) { throw "Bluetooth did not answer in 10 s." }
  $task.Result
}

$gatt = "Windows.Devices.Bluetooth.GenericAttributeProfile"
$heartService = [Guid]"0000180d-0000-1000-8000-00805f9b34fb"
$heartMeasurement = [Guid]"00002a37-0000-1000-8000-00805f9b34fb"

$made = Await ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider]::CreateAsync($heartService)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProviderResult])
if ($made.Error -ne "Success") { throw "The laptop cannot serve a heart rate strap: $($made.Error). Is its Bluetooth on?" }
$provider = $made.ServiceProvider

$parameters = New-Object "$gatt.GattLocalCharacteristicParameters"
$parameters.CharacteristicProperties = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties]::Notify
$parameters.ReadProtectionLevel = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattProtectionLevel]::Plain
$parameters.UserDescription = "Heart Rate Measurement"
$madeCharacteristic = Await ($provider.Service.CreateCharacteristicAsync($heartMeasurement, $parameters)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattLocalCharacteristicResult])
if ($madeCharacteristic.Error -ne "Success") { throw "The heart rate measurement was not made: $($madeCharacteristic.Error)." }
$measurement = $madeCharacteristic.Characteristic

$advertising = New-Object "$gatt.GattServiceProviderAdvertisingParameters"
$advertising.IsConnectable = $true
$advertising.IsDiscoverable = $true
$provider.StartAdvertising($advertising)
Write-Host "Serving a heart rate strap as this laptop's Bluetooth name ($env:COMPUTERNAME). Plan: $Plan. Ctrl+C stops it."

$notified = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Bluetooth.GenericAttributeProfile.GattClientNotificationResult]]
try {
  for ($s = 0; $s -lt $Seconds; $s++) {
    $inMinute = $s % 300
    if ($Plan -eq "run" -and $s -ge 240 -and $inMinute -ge 270 -and $inMinute -lt 280) {
      $bytes = [byte[]](0x04, 0) # no skin under the strap
      $said = "no skin"
    } elseif ($Plan -eq "run" -and $s -ge 240 -and $inMinute -ge 280) {
      $bytes = $null # taken off: nothing sent
      $said = "nothing"
    } else {
      $bpm = if ($Plan -eq "steady") { 120 } elseif ($s -lt 120) { [int](95 + 55 * $s / 120) } else { 150 + [int](7.5 + 7.5 * [Math]::Sin($s / 23.0)) }
      $beat = [int](60.0 / $bpm * 1024) # the time between beats, 1/1024 s, as the strap's own
      $bytes = [byte[]](0x16, $bpm, ($beat -band 0xff), ($beat -shr 8))
      $said = "$bpm bpm"
    }
    if ($null -ne $bytes) {
      # The bytes as Windows' own buffer: PowerShell cannot hand a DataWriter's to NotifyValueAsync.
      $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
      $sent = Await ($measurement.NotifyValueAsync($buffer)) $notified
      Write-Host ("{0,4}s  {1,-8}  phones listening: {2}" -f $s, $said, $sent.Count)
    } else {
      Write-Host ("{0,4}s  {1}" -f $s, $said)
    }
    Start-Sleep -Milliseconds 1000
  }
} finally {
  $provider.StopAdvertising()
  Write-Host "Stopped."
}
