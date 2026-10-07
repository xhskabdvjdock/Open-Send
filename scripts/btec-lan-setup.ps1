# Open Send - automatic LAN setup for the server PC (Windows 10 / 11 / Server).
# Called by scripts/setup-btec-lan.bat (requests admin for the firewall step).
#
# What it does (non-destructive - never disables the firewall, never changes IPs):
#   1. Detects Windows.
#   2. Detects the current network adapters / IPv4 addresses.
#   3. Verifies whether 192.168.1.118 is assigned to this machine.
#   4. Warns if the IP is different (does NOT change the Windows IP configuration).
#   5. Checks whether mDNS functionality is available (Node + multicast-dns + UDP 5353 rule).
#   6. Configures the required firewall rule for the app TCP port (needs admin; explains why).
#   7. Verifies the Open Send server is configured to listen on the network (0.0.0.0).
#   8. Verifies the server is reachable locally (if it is currently running).
#   9. Tests hostname resolution of btec-send.local.
#  10. Displays a final setup status.
#
# Environment overrides (same centralized config as lib/network.ts):
#   OPEN_SEND_HOST / OPENSEND_HOST_IP, OPEN_SEND_HOSTNAME / OPENSEND_HOSTNAME, PORT

param(
  [string]$ExpectedIp = $null,
  [string]$Hostname = $null,
  [int]$Port = 0
)

$ErrorActionPreference = 'Continue'

# Load .env next to the project (same values the server and mDNS use).
# Explicit environment / script parameters always win over the file.
$DotEnvPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (Test-Path -LiteralPath $DotEnvPath) {
  foreach ($line in (Get-Content -LiteralPath $DotEnvPath)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    if ($t -match '^(?i)export\s+') { $t = $t.Substring($Matches[0].Length).Trim() }
    $eq = $t.IndexOf('=')
    if ($eq -lt 0) { continue }
    $k = $t.Substring(0, $eq).Trim()
    $v = $t.Substring($eq + 1).Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    if ([string]::IsNullOrEmpty($k)) { continue }
    if (($k -eq 'OPEN_SEND_HOST' -or $k -eq 'OPENSEND_HOST_IP') -and -not $env:OPEN_SEND_HOST -and -not $env:OPENSEND_HOST_IP) {
      $env:OPEN_SEND_HOST = $v
    }
    if (($k -eq 'OPEN_SEND_HOSTNAME' -or $k -eq 'OPENSEND_HOSTNAME') -and -not $env:OPEN_SEND_HOSTNAME -and -not $env:OPENSEND_HOSTNAME) {
      $env:OPEN_SEND_HOSTNAME = $v
    }
  }
  Write-Host "Loaded .env overrides."
}

if (-not $ExpectedIp -or $ExpectedIp.Trim() -eq '') {
  if ($env:OPEN_SEND_HOST) { $ExpectedIp = $env:OPEN_SEND_HOST }
  elseif ($env:OPENSEND_HOST_IP) { $ExpectedIp = $env:OPENSEND_HOST_IP }
  else { $ExpectedIp = '192.168.1.118' }
}
if (-not $Hostname -or $Hostname.Trim() -eq '') {
  if ($env:OPEN_SEND_HOSTNAME) { $Hostname = $env:OPEN_SEND_HOSTNAME }
  elseif ($env:OPENSEND_HOSTNAME) { $Hostname = $env:OPENSEND_HOSTNAME }
  else { $Hostname = 'btec-send.local' }
}
if (-not $Port -or $Port -le 0) {
  if ($env:PORT) { [int]$Port = $env:PORT } else { $Port = 80 }
}
$ExpectedIp = $ExpectedIp.Trim()
$Hostname = $Hostname.Trim().ToLower()

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ok = @()
$warn = @()
$fail = @()

function Status($name, $state, $detail) {
  return [pscustomobject]@{ Check = $name; State = $state; Detail = $detail }
}
$results = @()

Write-Host ''
Write-Host 'Open Send - LAN setup (btec-send.local)' -ForegroundColor Cyan
Write-Host "Expected IP : $ExpectedIp"
Write-Host "Hostname    : $Hostname"
Write-Host "Port        : $Port"
Write-Host ''

# --- 1. Detect Windows -------------------------------------------------------
$results += Status 'Windows' 'OK' "$([Environment]::OSVersion.VersionString)"
Write-Host '[1/10] Windows detected.' -ForegroundColor Green

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '        NOTE: not running as Administrator - firewall rules will be checked only.' -ForegroundColor Yellow
  Write-Host '        Re-run scripts\setup-btec-lan.bat (it self-elevates) to apply them.' -ForegroundColor Yellow
}

# --- 2. Detect adapters / IPs ------------------------------------------------
Write-Host '[2/10] Detecting network adapters...' -ForegroundColor Green
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress
} catch {
  try {
    $ips = (ipconfig | Select-String 'IPv4 Address' | ForEach-Object {
      ($_ -split ':')[-1].Trim()
    })
  } catch {}
}
$ips = @($ips | Sort-Object -Unique)
Write-Host "        Detected IPv4: $($ips -join ', ')"
$results += Status 'Adapters / IP' 'OK' ($ips -join ', ')

# --- 3+4. Verify expected IP -------------------------------------------------
Write-Host '[3/10] Verifying expected server IP...' -ForegroundColor Green
if ($ips -contains $ExpectedIp) {
  Write-Host "        $ExpectedIp is assigned to this machine." -ForegroundColor Green
  $results += Status 'Expected IP' 'OK' "$ExpectedIp assigned"
} else {
  Write-Host '' -ForegroundColor Yellow
  Write-Host 'Open Send Network Warning' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Expected server IP:'
  Write-Host $ExpectedIp
  Write-Host ''
  Write-Host 'Current network configuration does not contain this IP.'
  Write-Host ''
  Write-Host "$Hostname may not work correctly."
  Write-Host ''
  Write-Host 'Please verify the network adapter configuration.'
  Write-Host '(This script does NOT change your IP - set 192.168.1.118 manually in'
  Write-Host ' Windows Settings > Network > Adapter > IPv4 properties, then re-run.)'
  Write-Host ''
  $results += Status 'Expected IP' 'WARN' "not assigned (have: $($ips -join ', '))"
}

# --- Network profile (Private / Public) --------------------------------------
try {
  $profiles = Get-NetConnectionProfile -ErrorAction Stop
  foreach ($p in $profiles) {
    Write-Host "        Adapter '$($p.InterfaceAlias)': $($p.NetworkCategory) ($($p.IPv4Connectivity))"
  }
  if ($profiles | Where-Object { $_.NetworkCategory -eq 'Public' }) {
    Write-Host ''
    Write-Host 'Open Send Network' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Your current Windows network profile is Public.'
    Write-Host ''
    Write-Host 'Open Send is designed for trusted local networks.'
    Write-Host ''
    Write-Host 'Please verify the network before allowing other devices to connect.'
    Write-Host '(Settings > Network > Wi-Fi/Ethernet > set to Private. Not changed automatically.)'
    Write-Host ''
    $results += Status 'Network profile' 'WARN' 'Public detected - verify before sharing'
  } else {
    $results += Status 'Network profile' 'OK' 'Private (or unknown)'
  }
} catch {
  $results += Status 'Network profile' 'WARN' 'could not query (Get-NetConnectionProfile failed)'
}

# --- 5. mDNS availability ----------------------------------------------------
Write-Host '[5/10] Checking mDNS functionality...' -ForegroundColor Green
$nodeOk = $false
$mdnsModOk = $false
try {
  $nv = (node --version) 2>$null
  if ($LASTEXITCODE -eq 0 -and $nv) { $nodeOk = $true; Write-Host "        Node: $nv" }
} catch {}
if (-not $nodeOk) {
  Write-Host '        Node.js not found on PATH - install Node 22+ first.' -ForegroundColor Yellow
  $results += Status 'mDNS (Node)' 'WARN' 'node not found'
} else {
  if (Test-Path (Join-Path $ProjectRoot 'node_modules\multicast-dns')) {
    $mdnsModOk = $true
    Write-Host '        multicast-dns module: present (lightweight, already a dependency).'
  } else {
    Write-Host '        multicast-dns module: MISSING - run `npm install` on the server.' -ForegroundColor Yellow
  }
  if ($mdnsModOk) {
    $results += Status 'mDNS (module)' 'OK' 'multicast-dns present'
  } else {
    $results += Status 'mDNS (module)' 'WARN' 'run npm install'
  }
}
$mdnsRule = $null
try {
  $mdnsRule = Get-NetFirewallRule -DisplayName 'mDNS (UDP 5353)' -ErrorAction SilentlyContinue
} catch {}
if ($mdnsRule) {
  Write-Host '        Firewall rule "mDNS (UDP 5353)": present.'
  $results += Status 'mDNS (firewall)' 'OK' 'UDP 5353 allowed'
} else {
  Write-Host '        Firewall rule "mDNS (UDP 5353)": missing.' -ForegroundColor Yellow
  if ($isAdmin) {
    try {
      New-NetFirewallRule -DisplayName 'mDNS (UDP 5353)' -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private -ErrorAction Stop | Out-Null
      Write-Host '        Created inbound UDP 5353 (Private) rule.' -ForegroundColor Green
      $results += Status 'mDNS (firewall)' 'OK' 'UDP 5353 rule created'
    } catch {
      Write-Host '        Could not create UDP 5353 rule automatically.' -ForegroundColor Yellow
      $results += Status 'mDNS (firewall)' 'WARN' 'manual rule needed'
    }
  } else {
    Write-Host '        (Admin required - re-run as admin, or run:'
    Write-Host '         New-NetFirewallRule -DisplayName "mDNS (UDP 5353)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private)'
    $results += Status 'mDNS (firewall)' 'WARN' 'needs admin to create UDP 5353 rule'
  }
}

# --- 5b. Local hosts fast-path (instant resolution on THIS Windows PC) -----------
# mDNS answers in milliseconds on the wire, but Windows' own resolver can take
# seconds on a cold lookup. A hosts entry bypasses DNS+mDNS entirely for this
# machine (phones don't need it — they resolve .local natively and fast).
# Non-destructive: adds ONE line if missing, backs the file up first, reversible.
Write-Host '[5/10] Checking hosts fast-path entry...' -ForegroundColor Green
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostsEntry = "$ExpectedIp $Hostname"
try {
  $hostsContent = @(Get-Content -LiteralPath $hostsPath -ErrorAction Stop)
  $escaped = [regex]::Escape($Hostname)
  if ($hostsContent | Where-Object { $_ -match $escaped }) {
    Write-Host '        Hosts entry already present (instant local resolution).'
    $results += Status 'Hosts fast-path' 'OK' $hostsEntry
  } elseif ($isAdmin) {
    Copy-Item -LiteralPath $hostsPath ($hostsPath + '.bak-opensend') -Force -ErrorAction Stop
    Add-Content -LiteralPath $hostsPath '' -ErrorAction Stop
    Add-Content -LiteralPath $hostsPath $hostsEntry -ErrorAction Stop
    try { ipconfig /flushdns | Out-Null } catch {}
    Write-Host "        Added: $hostsEntry (backup saved as hosts.bak-opensend)." -ForegroundColor Green
    $results += Status 'Hosts fast-path' 'OK' 'entry added'
  } else {
    Write-Host '        No hosts entry yet (needs admin — first page load on this PC may take a few seconds).'
    Write-Host "        Re-run as admin to add: $hostsEntry"
    $results += Status 'Hosts fast-path' 'WARN' 're-run as admin for instant resolution'
  }
} catch {
  Write-Host '        Could not read the hosts file.' -ForegroundColor Yellow
  $results += Status 'Hosts fast-path' 'WARN' 'could not read hosts file'
}

# --- 6. App firewall rule (TCP port only) --------------------------------------
Write-Host "[6/10] Checking app firewall rule (TCP $Port)..." -ForegroundColor Green
$ruleName = 'Open Send Server'
$appRule = $null
try {
  $appRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
} catch {}
if ($appRule) {
  Write-Host "        Firewall rule `"$ruleName`": present."
  $results += Status 'Firewall (app)' 'OK' "TCP $Port allowed ($ruleName)"
} else {
  Write-Host "        Firewall rule `"$ruleName`": missing."
  if ($isAdmin) {
    try {
      # Only the actual app TCP port, Private profile only. Never disables the firewall.
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private -ErrorAction Stop | Out-Null
      Write-Host "        Created: $ruleName / TCP inbound / port $Port / Private." -ForegroundColor Green
      $results += Status 'Firewall (app)' 'OK' "rule created (TCP $Port, Private)"
    } catch {
      Write-Host '        Could not create the rule automatically.' -ForegroundColor Yellow
      $results += Status 'Firewall (app)' 'WARN' 'manual rule needed'
    }
  } else {
    Write-Host '        Administrator privileges are required to add an inbound firewall rule.'
    Write-Host '        Why: Windows blocks incoming LAN connections by default; Open Send needs'
    Write-Host "        exactly one port opened (TCP $Port, Private networks only)."
    Write-Host "        Run: New-NetFirewallRule -DisplayName `"Open Send Server`" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private"
    $results += Status 'Firewall (app)' 'WARN' 'needs admin to create rule'
  }
}

# --- 7. Server listens on the network ------------------------------------------
Write-Host '[7/10] Checking server bind configuration...' -ForegroundColor Green
$bindOk = $false
try {
  $pkg = Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
  $starts = @($pkg.scripts.start, $pkg.scripts.'start:lan')
  foreach ($s in $starts) {
    if ($s -match '0\.0\.0\.0') { $bindOk = $true }
  }
  if ($bindOk) {
    Write-Host '        package.json start scripts bind 0.0.0.0 (LAN + local).'
    $results += Status 'Server bind' 'OK' '0.0.0.0 (not localhost-only)'
  } else {
    Write-Host '        WARNING: start script does not bind 0.0.0.0 - LAN devices cannot connect.' -ForegroundColor Yellow
    $results += Status 'Server bind' 'WARN' 'start script must use -H 0.0.0.0'
  }
} catch {
  $results += Status 'Server bind' 'WARN' 'could not read package.json'
}

# --- 8. Reachable locally --------------------------------------------------------
Write-Host '[8/10] Checking local reachability...' -ForegroundColor Green
$reachOk = $false
foreach ($u in @("http://localhost:$Port/api/health", 'http://localhost/api/health')) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($r.StatusCode -eq 200) {
      Write-Host "        Reachable: $u (HTTP $($r.StatusCode))." -ForegroundColor Green
      $reachOk = $true
      $results += Status 'Local reachability' 'OK' $u
      break
    }
  } catch {}
}
if (-not $reachOk) {
  Write-Host '        Server is not responding yet (it may simply not be started).' -ForegroundColor Yellow
  Write-Host '        Start it with start-lan.bat, then re-run this setup to verify.'
  $results += Status 'Local reachability' 'WARN' 'server not running (start with start-lan.bat)'
}

# --- 9. Hostname resolution -------------------------------------------------------
Write-Host '[9/10] Testing hostname resolution...' -ForegroundColor Green
$resolved = $null
try {
  $resolved = ([System.Net.Dns]::GetHostEntry($Hostname)).AddressList |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
    Select-Object -ExpandProperty IPAddressToString
} catch {}
if ($resolved -and ($resolved -contains $ExpectedIp)) {
  Write-Host "        $Hostname -> $ExpectedIp [OK]" -ForegroundColor Green
  $results += Status 'Hostname' 'OK' "$Hostname -> $ExpectedIp"
} elseif ($resolved) {
  Write-Host "        $Hostname resolves to $($resolved -join ', ') (expected $ExpectedIp)." -ForegroundColor Yellow
  Write-Host "        Open Send is still running on: http://${ExpectedIp}:$Port"
  $results += Status 'Hostname' 'WARN' "resolves to $($resolved -join ', ')"
} else {
  Write-Host "        (!) $Hostname could not be resolved." -ForegroundColor Yellow
  Write-Host ''
  Write-Host "        Open Send is still running on:"
  Write-Host "        http://${ExpectedIp}:$Port"
  Write-Host '        (Start the server with start-lan.bat so scripts\mdns.mjs advertises the name,'
  Write-Host '         allow UDP 5353, and keep the client on the same network. Android <12: use the IP.)'
  $results += Status 'Hostname' 'WARN' 'could not be resolved (server still works via IP)'
}

# --- 10. Final status ---------------------------------------------------------------
Write-Host ''
Write-Host '[10/10] Final setup status:' -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
$bad = @($results | Where-Object { $_.State -eq 'WARN' })
if ($bad.Count -eq 0) {
  Write-Host 'All checks passed. Students on the same network can open:' -ForegroundColor Green
  if ($Port -eq 80) { Write-Host "  http://$Hostname" -ForegroundColor Green }
  else { Write-Host "  http://${Hostname}:$Port" -ForegroundColor Green }
} else {
  Write-Host "$($bad.Count) warning(s) - the server still works via IP:" -ForegroundColor Yellow
  if ($Port -eq 80) { Write-Host "  http://$ExpectedIp" -ForegroundColor Yellow }
  else { Write-Host "  http://${ExpectedIp}:$Port" -ForegroundColor Yellow }
  Write-Host 'Fix the warnings above, then re-run this script.'
}
Write-Host ''
Write-Host 'Notes: no system IP was changed, the firewall was not disabled, and no'
Write-Host 'ports were forwarded - everything stays on the local network.'
