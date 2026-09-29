# Runs elevated. __IDS__, __LOG__ and __RESTORE__ are filled in by driver-ipc.js.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ids = @(__IDS__)
$log = '__LOG__'
$enc = New-Object Text.UTF8Encoding($false)
function W($h) { [IO.File]::AppendAllText($log, ((ConvertTo-Json -InputObject $h -Compress) + "`n"), $enc) }
try {
  if (__RESTORE__) {
    W @{ t = 'status'; m = 'Creating a restore point...' }
    try {
      Checkpoint-Computer -Description 'Zanes Utilities driver update' -RestorePointType 'DEVICE_DRIVER_INSTALL' -ErrorAction Stop
      W @{ t = 'status'; m = 'Restore point created.' }
    } catch {
      W @{ t = 'warn'; m = ('No restore point was created: ' + $_.Exception.Message) }
    }
  }
  W @{ t = 'status'; m = 'Finding the selected drivers...' }
  $s = New-Object -ComObject Microsoft.Update.Session
  $s.ClientApplicationID = 'ZanesUtilities'
  $r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
  $col = New-Object -ComObject Microsoft.Update.UpdateColl
  foreach ($u in $r.Updates) {
    if ($ids -contains [string]$u.Identity.UpdateID) {
      if (-not $u.EulaAccepted) { $u.AcceptEula() }
      [void]$col.Add($u)
    }
  }
  if ($col.Count -eq 0) {
    W @{ t = 'done'; ok = $true; reboot = $false; m = 'Nothing to install. Windows Update no longer offers the selected drivers.' }
    exit
  }
  W @{ t = 'status'; m = ('Downloading ' + $col.Count + ' driver(s)...') }
  $dl = $s.CreateUpdateDownloader()
  $dl.Updates = $col
  $dr = $dl.Download()
  if (@(2, 3) -notcontains [int]$dr.ResultCode) { throw ('Download failed (code ' + $dr.ResultCode + ').') }
  W @{ t = 'status'; m = 'Installing... the screen may flicker briefly.' }
  $in = $s.CreateUpdateInstaller()
  $in.Updates = $col
  $ir = $in.Install()
  for ($k = 0; $k -lt $col.Count; $k++) {
    $ur = $ir.GetUpdateResult($k)
    W @{ t = 'item'; title = [string]$col.Item($k).Title; code = [int]$ur.ResultCode; reboot = [bool]$ur.RebootRequired }
  }
  W @{ t = 'done'; ok = (@(2, 3) -contains [int]$ir.ResultCode); reboot = [bool]$ir.RebootRequired; code = [int]$ir.ResultCode }
} catch {
  W @{ t = 'done'; ok = $false; m = [string]$_.Exception.Message }
}
