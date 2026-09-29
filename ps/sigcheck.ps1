# Reports the Authenticode signature of one file. __FILE__ is filled in by vendor-ipc.js.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $s = Get-AuthenticodeSignature -LiteralPath '__FILE__'
  $sub = ''; $cn = ''
  if ($s.SignerCertificate) {
    $sub = [string]$s.SignerCertificate.Subject
    $cn = [string]$s.SignerCertificate.GetNameInfo('SimpleName', $false)
  }
  ConvertTo-Json -InputObject @{ status = [string]$s.Status; subject = $sub; cn = $cn } -Compress
} catch {
  ConvertTo-Json -InputObject @{ status = 'Error'; subject = ''; cn = ''; error = [string]$_.Exception.Message } -Compress
}
