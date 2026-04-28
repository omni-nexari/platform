##############################################################################
# serve-b2btest.ps1  —  DEV ONLY
#
# 1. Packages NexariPlayer4.wgt (testforsbb profile)
# 2. Updates sssp_config.xml with real file size
# 3. Starts a local HTTP server on port 8080
# 4. Serves GET /download/* from apps/nexari-tizen4/
#
# On the TV:  Menu → System → Play via → URL Launcher
#             URL: http://<THIS_MACHINE_IP>:8080/download/sssp_config.xml
#
# Press Ctrl-C to stop the server.
##############################################################################
param(
    [int]$port = 8080,
    [string]$sign = "testforsbb"
)

$src   = "C:\Users\chiho\Projects\Platform\apps\nexari-tizen4"
$tizen = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$tmp   = "$env:TEMP\nexari-b2btest-build"

# --- 1. PACKAGE ---
Write-Host "=== Packaging with $sign profile ==="
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @('.sign', '.settings', '.project', '.tproject', '.manifest.tmp')
foreach ($item in Get-ChildItem $src) {
    if ($excludeNames -contains $item.Name) { continue }
    if ($item.Extension -eq '.wgt') { continue }
    if ($item.PSIsContainer) {
        Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse
    } else {
        Copy-Item $item.FullName $tmp
    }
}

Remove-Item "$src\*.wgt" -ErrorAction SilentlyContinue

& $tizen package --type wgt --sign $sign -o $src -- $tmp 2>&1 | Out-String | Write-Host
if ($LASTEXITCODE -ne 0) { Write-Error "Packaging failed"; exit 1 }

$wgtItem = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgtItem) { Write-Error "No .wgt produced"; exit 1 }

# --- 2. UPDATE sssp_config.xml WITH REAL SIZE ---
$wgtSize = $wgtItem.Length
$ssspPath = Join-Path $src "sssp_config.xml"
[xml]$sssp = Get-Content $ssspPath
$sssp.widget.size = [string]$wgtSize
$sssp.Save($ssspPath)
Write-Host "Updated sssp_config.xml: $($wgtItem.Name) = $wgtSize bytes"

# --- 3. DETECT LAN IP ---
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.PrefixOrigin -eq 'Dhcp' -or $_.PrefixOrigin -eq 'Manual' } |
          Where-Object { $_.IPAddress -notmatch '^(127|169)' } |
          Select-Object -First 1).IPAddress

if (-not $lanIP) { $lanIP = "127.0.0.1" }

# --- 4. START HTTP SERVER ---
$prefix = "http://+:$port/download/"
Write-Host ""
Write-Host "=== Starting HTTP server ==="
Write-Host "  Serving:  $src"
Write-Host "  URL base: http://${lanIP}:${port}/download/"
Write-Host ""
Write-Host "  On the TV set URL Launcher to:"
Write-Host "  http://${lanIP}:${port}/download/sssp_config.xml"
Write-Host ""
Write-Host "Press Ctrl-C to stop."
Write-Host ""

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Write-Warning "Could not bind http://+:$port — trying localhost only."
    Write-Warning "To fix: run as Administrator, OR run:"
    Write-Warning "  netsh http add urlacl url=http://+:$port/download/ user=Everyone"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/download/")
    $listener.Start()
    Write-Host "Listening on http://localhost:$port/download/ only"
}

while ($listener.IsListening) {
    try {
        $ctx  = $listener.GetContext()
        $req  = $ctx.Request
        $resp = $ctx.Response

        # Strip /download/ prefix to get relative filename
        $relPath = $req.Url.AbsolutePath -replace '^/download/', ''
        $relPath = $relPath.TrimStart('/')
        $filePath = Join-Path $src $relPath

        Write-Host "$($req.HttpMethod) /$relPath  ->  " -NoNewline

        if ($req.HttpMethod -ne 'GET') {
            $resp.StatusCode = 405
            $resp.Close()
            Write-Host "405 Method Not Allowed"
            continue
        }

        if (-not $relPath -or -not (Test-Path $filePath -PathType Leaf)) {
            $resp.StatusCode = 404
            $body = [System.Text.Encoding]::UTF8.GetBytes("Not found: $relPath")
            $resp.ContentLength64 = $body.Length
            $resp.OutputStream.Write($body, 0, $body.Length)
            $resp.Close()
            Write-Host "404"
            continue
        }

        # Content-Type
        $ct = switch ([System.IO.Path]::GetExtension($relPath).ToLower()) {
            '.xml'  { 'text/xml; charset=utf-8' }
            '.wgt'  { 'application/widget' }
            '.html' { 'text/html; charset=utf-8' }
            '.js'   { 'application/javascript' }
            '.css'  { 'text/css' }
            default { 'application/octet-stream' }
        }

        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $resp.StatusCode = 200
        $resp.ContentType = $ct
        $resp.ContentLength64 = $bytes.Length
        $resp.Headers.Add("Cache-Control", "no-cache")
        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        $resp.Close()
        Write-Host "200 ($($bytes.Length) bytes)"

    } catch [System.Net.HttpListenerException] {
        # Listener was stopped (Ctrl-C)
        break
    } catch {
        Write-Warning "Request error: $_"
        try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
    }
}

$listener.Stop()
Write-Host "Server stopped."
