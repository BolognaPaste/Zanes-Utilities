# Lists the device drivers installed on this PC, the driver packages that report their own
# version (chipset software), and which PC / motherboard maker built it. Needs no admin rights.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = New-Object System.Collections.ArrayList
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DriverVersion } | ForEach-Object {
[void]$o.Add([pscustomobject]@{ k = 'drv'; name = [string]$_.DeviceName; cls = [string]$_.DeviceClass; mfr = [string]$_.Manufacturer; prov = [string]$_.DriverProviderName; ver = [string]$_.DriverVersion; id = [string]$_.DeviceID })
}
$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty -Path $keys | Where-Object { $_.DisplayName -match 'chipset' -and $_.DisplayVersion } | ForEach-Object {
[void]$o.Add([pscustomobject]@{ k = 'app'; name = [string]$_.DisplayName; cls = ''; mfr = [string]$_.Publisher; prov = [string]$_.Publisher; ver = [string]$_.DisplayVersion })
}
$cs = Get-CimInstance Win32_ComputerSystem
$bb = Get-CimInstance Win32_BaseBoard
$bi = Get-CimInstance Win32_BIOS
$sn = ''
if (([string]$cs.Manufacturer + ' ' + [string]$bb.Manufacturer) -match 'dell|alienware') { $sn = [string]$bi.SerialNumber }
[void]$o.Add([pscustomobject]@{ k = 'pc'; name = [string]$cs.Model; cls = ''; mfr = [string]$cs.Manufacturer; prov = [string]$bb.Manufacturer; ver = $sn })
ConvertTo-Json -InputObject @($o) -Compress
