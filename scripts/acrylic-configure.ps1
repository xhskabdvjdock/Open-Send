# Open Send — Acrylic DNS Proxy configurator (called by acrylic-setup.bat).
# Patches AcrylicConfiguration.ini (bind all interfaces + allow LAN subnet)
# and ensures the open-send.btec hosts entry. Backups are made by the caller.
param(
  [string]$Ini,
  [string]$Subnet,
  [string]$HostsFile,
  [string]$LanIp
)

$lines = Get-Content -LiteralPath $Ini
$out = @()
$inSec = $false; $hasSec = $false; $hasNet = $false
foreach ($l in $lines) {
  if ($l -match '^\s*LocalIPv4BindingAddress\s*=') { $out += 'LocalIPv4BindingAddress=0.0.0.0'; continue }
  if ($l -match '^\s*\[AllowedAddressesSection\]') { $inSec = $true; $hasSec = $true; $out += $l; continue }
  if ($inSec -and $l -match '^\s*\[') { if (-not $hasNet) { $out += $Subnet }; $inSec = $false }
  if ($inSec -and $l.Trim() -eq $Subnet) { $hasNet = $true }
  $out += $l
}
if (-not $hasSec) { $out += '[AllowedAddressesSection]'; $out += $Subnet }
elseif ($inSec -and -not $hasNet) { $out += $Subnet }
if (-not ($out -match '^\s*LocalIPv4BindingAddress\s*=')) { $out += 'LocalIPv4BindingAddress=0.0.0.0' }
$out | Set-Content -LiteralPath $Ini -Encoding ASCII
Write-Output "ini patched: bind=0.0.0.0 allowed=$Subnet"

$entry = "$LanIp open-send.btec www.open-send.btec"
$hlines = Get-Content -LiteralPath $HostsFile
$found = $false
for ($i = 0; $i -lt $hlines.Count; $i++) {
  if ($hlines[$i] -match 'open-send\.btec') { $hlines[$i] = $entry; $found = $true }
}
if (-not $found) { $hlines += ''; $hlines += $entry }
$hlines | Set-Content -LiteralPath $HostsFile -Encoding ASCII
Write-Output "hosts entry: $entry"
