# Reports the Authenticode signature of one file. __FILE__ is filled in by vendor-ipc.js.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $s = Get-AuthenticodeSignature -LiteralPath '__FILE__'
  $sub = ''
  if ($s.SignerCertificate) { $sub = [string]$s.SignerCertificate.Subject }
  ConvertTo-Json -InputObject @{ status = [string]$s.Status; subject = $sub } -Compress
} catch {
  ConvertTo-Json -InputObject @{ status = 'Error'; subject = ''; error = [string]$_.Exception.Message } -Compress
}
