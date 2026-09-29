# Lists the graphics adapters in this PC, for the NVIDIA / AMD / Intel manufacturer check.
# Needs no admin rights.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -eq 'DISPLAY' -and $_.DeviceName } | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.DeviceName
    mfr  = [string]$_.Manufacturer
    ver  = [string]$_.DriverVersion
  }
})
ConvertTo-Json -InputObject @($o) -Compress
