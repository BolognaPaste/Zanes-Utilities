# Searches Windows Update for available, Microsoft-signed driver updates. Needs no admin rights;
# only installing (install.ps1) does. Nothing is downloaded or installed here.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'ZanesUtilities'
$r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
$o = @($r.Updates | ForEach-Object {
  $d = ''
  if ($_.DriverVerDate) {
    try { $d = ([datetime]$_.DriverVerDate).ToString('yyyy-MM-dd') } catch {}
  }
  [pscustomobject]@{
    id   = [string]$_.Identity.UpdateID
    name = [string]$_.Title
    mfr  = [string]$_.DriverManufacturer
    cls  = [string]$_.DriverClass
    ver  = [string]$_.DriverVerVersion
    date = $d
    mb   = [math]::Round($_.MaxDownloadSize / 1MB, 1)
  }
})
ConvertTo-Json -InputObject @($o) -Compress
