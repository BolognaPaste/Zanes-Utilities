$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
while (($line = [Console]::In.ReadLine()) -ne $null) {
$res = 'ok'
try {
$parts = $line.Trim().Split(' ')
$kind = $parts[0]
$p = $utf8.GetString([Convert]::FromBase64String($parts[1]))
$t = (New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)).AddMilliseconds([double]$parts[2])
if ($kind -eq 'f') {
try { [System.IO.File]::SetAttributes($p, [System.IO.FileAttributes]::Normal) } catch {}
try {
foreach ($s in @(Get-Item -LiteralPath $p -Stream * -ErrorAction Stop | Where-Object { $_.Stream -ne ':$DATA' })) {
$n = $s.Stream
try {
$b = New-Object byte[] ([int][Math]::Max(1, [Math]::Min($s.Length, 1048576)))
$rng.GetBytes($b)
Set-Content -LiteralPath $p -Stream $n -Value $b -Encoding Byte -ErrorAction Stop
} catch {}
try { Remove-Item -LiteralPath $p -Stream $n -ErrorAction Stop } catch {}
}
} catch {}
[System.IO.File]::SetCreationTimeUtc($p, $t)
} else {
[System.IO.Directory]::SetCreationTimeUtc($p, $t)
}
} catch { $res = 'err' }
[Console]::Out.WriteLine($res)
[Console]::Out.Flush()
}
