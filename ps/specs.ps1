# Reads this PC's hardware for the Game optimizer. Needs no admin rights and changes nothing.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$mem = @(Get-CimInstance Win32_PhysicalMemory)
$vram = @{}
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  $q = $p.'HardwareInformation.qwMemorySize'
  if ($q -is [byte[]]) { $q = [BitConverter]::ToInt64($q, 0) }
  if ($p.DriverDesc -and $q) { $vram[[string]$p.DriverDesc] = [double]$q }
}
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  $v = $vram[[string]$_.Name]
  if (-not $v) { $v = [double]$_.AdapterRAM }
  [pscustomobject]@{
    name = [string]$_.Name
    vram = [math]::Round($v / 1GB, 1)
    drv = [string]$_.DriverVersion
    date = $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' })
    w = [int]$_.CurrentHorizontalResolution
    h = [int]$_.CurrentVerticalResolution
    hz = [int]$_.CurrentRefreshRate
  }
})
$disks = @(Get-PhysicalDisk | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.FriendlyName; type = [string]$_.MediaType; bus = [string]$_.BusType; gb = [math]::Round($_.Size / 1GB) }
})
$os = Get-CimInstance Win32_OperatingSystem
$hags = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers').HwSchMode
$m1 = $mem | Select-Object -First 1
$o = [pscustomobject]@{
  cpu = [pscustomobject]@{ name = ([string]$cpu.Name).Trim(); cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors; mhz = [int]$cpu.MaxClockSpeed }
  ram = [pscustomobject]@{ gb = [math]::Round((($mem | Measure-Object Capacity -Sum).Sum) / 1GB, 1); sticks = $mem.Count; mhz = [int]$m1.ConfiguredClockSpeed; type = [int]$m1.SMBIOSMemoryType }
  gpus = $gpus
  disks = $disks
  os = [string]$os.Caption
  laptop = [bool](Get-CimInstance Win32_Battery)
  hags = $(if ($hags) { [int]$hags } else { 0 })
}
ConvertTo-Json -InputObject $o -Depth 5 -Compress
