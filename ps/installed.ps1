# Lists the drivers currently installed. Needs no admin rights.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | Sort-Object DeviceClass, DeviceName | ForEach-Object {
  $d = ''
  if ($_.DriverDate) { $d = $_.DriverDate.ToString('yyyy-MM-dd') }
  [pscustomobject]@{
    name = [string]$_.DeviceName
    mfr  = [string]$_.Manufacturer
    ver  = [string]$_.DriverVersion
    date = $d
    cls  = [string]$_.DeviceClass
  }
})
ConvertTo-Json -InputObject @($o) -Compress
