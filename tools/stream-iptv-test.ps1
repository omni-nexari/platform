<#
.SYNOPSIS
  Local IPTV test streamer – outputs both HLS (consumer SmartTV) and
  UDP multicast (SSSP commercial panels) from the same source.

  HLS  (consumer SmartTV / universal):
    CH1  http://<your-ip>:9888/ch1/stream.m3u8  → MP4 file loop
    CH2  http://<your-ip>:9888/ch2/stream.m3u8  → Webcam

  UDP multicast  (SSSP commercial panels):
    CH1  udp://239.0.0.1:1234
    CH2  udp://239.0.0.2:1234

.USAGE
  Start (both):  .\tools\stream-iptv-test.ps1
  HLS only:      .\tools\stream-iptv-test.ps1 -Mode hls
  UDP only:      .\tools\stream-iptv-test.ps1 -Mode udp
  Stop:          .\tools\stream-iptv-test.ps1 -Stop

.PARAMETER Stop
  Kill all running IPTV test streams and exit.

.PARAMETER Mode
  'both' (default), 'hls', or 'udp'.

.PARAMETER Port
  HTTP port for HLS. Default: 9888
#>
param(
    [switch]$Stop,
    [ValidateSet('both','hls','udp')][string]$Mode = 'both',
    [int]$Port = 9888
)

$VideoFile = "C:\Users\chiho\Videos\content\1-8. Around the World (FHD).mp4"
$Webcam    = "720p HD Camera"
$HlsRoot   = "$env:TEMP\iptv-hls"
$PidFile   = "$env:TEMP\iptv-test-pids.json"

# ── Stop helper ───────────────────────────────────────────────────────────────
function Stop-IptvStreams {
    $killed = 0
    if (Test-Path $PidFile) {
        $saved = Get-Content $PidFile -Raw | ConvertFrom-Json
        foreach ($id in $saved) {
            $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($proc) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; $killed++ }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
    Get-Process ffmpeg -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; $killed++ }
    return $killed
}

if ($Stop) {
    $n = Stop-IptvStreams
    Write-Host "Stopped $n process(es)." -ForegroundColor Yellow
    exit 0
}

if (Get-Process ffmpeg -ErrorAction SilentlyContinue) {
    Write-Host "Killing existing ffmpeg processes..." -ForegroundColor Yellow
    Stop-IptvStreams | Out-Null
    Start-Sleep -Milliseconds 500
}

$localIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress

$doHls = $Mode -in 'both','hls'
$doUdp = $Mode -in 'both','udp'

Write-Host "`n=== IPTV Test Streamer ===" -ForegroundColor Cyan
Write-Host "Mode: $Mode   IP: $localIp"

if ($doHls) {
    Write-Host "`n[HLS — consumer SmartTV]" -ForegroundColor Yellow
    Write-Host "  1  Around the World  HLS  http://${localIp}:${Port}/ch1/stream.m3u8"
    Write-Host "  2  Webcam Live       HLS  http://${localIp}:${Port}/ch2/stream.m3u8"
}
if ($doUdp) {
    Write-Host "`n[UDP multicast — SSSP commercial panels]" -ForegroundColor Yellow
    Write-Host "  1  Around the World  UDP  udp://239.0.0.1:1234"
    Write-Host "  2  Webcam Live       UDP  udp://239.0.0.2:1234"
}
Write-Host "`nStarting encoders..." -ForegroundColor Green

$allPids = @()

# ── HLS encoders + HTTP server ────────────────────────────────────────────────
if ($doHls) {
    $ch1Dir = "$HlsRoot\ch1"; $ch2Dir = "$HlsRoot\ch2"
    New-Item -ItemType Directory -Path $ch1Dir,$ch2Dir -Force | Out-Null

    $p1 = Start-Process ffmpeg -ArgumentList @(
        '-hide_banner','-loglevel','warning',
        '-re','-stream_loop','-1','-i',"`"$VideoFile`"",
        '-c:v','libx264','-preset','veryfast','-tune','zerolatency',
        '-b:v','3M','-maxrate','3.5M','-bufsize','6M',
        '-pix_fmt','yuv420p','-g','60','-sc_threshold','0',
        '-c:a','aac','-b:a','128k','-ar','44100',
        '-f','hls','-hls_time','2','-hls_list_size','5',
        '-hls_flags','delete_segments+append_list',
        '-hls_segment_filename',"`"$ch1Dir\seg%05d.ts`"",
        "`"$ch1Dir\stream.m3u8`""
    ) -WindowStyle Hidden -PassThru

    $p2 = Start-Process ffmpeg -ArgumentList @(
        '-hide_banner','-loglevel','warning',
        '-f','dshow','-video_size','1280x720','-framerate','30',
        '-i',"video=`"$Webcam`"",
        '-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
        '-b:v','2M','-pix_fmt','yuv420p','-g','60','-sc_threshold','0','-an',
        '-f','hls','-hls_time','2','-hls_list_size','5',
        '-hls_flags','delete_segments+append_list',
        '-hls_segment_filename',"`"$ch2Dir\seg%05d.ts`"",
        "`"$ch2Dir\stream.m3u8`""
    ) -WindowStyle Hidden -PassThru

    $ph = Start-Process python -ArgumentList @(
        '-m','http.server',$Port,'--directory',"`"$HlsRoot`"",'--bind','0.0.0.0'
    ) -WindowStyle Hidden -PassThru

    $allPids += $p1.Id,$p2.Id,$ph.Id
    Write-Host "HLS  CH1:$($p1.Id) CH2:$($p2.Id) HTTP:$($ph.Id)" -ForegroundColor DarkGray
}

# ── UDP multicast encoders ─────────────────────────────────────────────────────
if ($doUdp) {
    $u1 = Start-Process ffmpeg -ArgumentList @(
        '-hide_banner','-loglevel','warning',
        '-re','-stream_loop','-1','-i',"`"$VideoFile`"",
        '-c:v','libx264','-preset','veryfast','-tune','zerolatency',
        '-b:v','5M','-maxrate','6M','-bufsize','10M',
        '-pix_fmt','yuv420p','-g','60',
        '-c:a','aac','-b:a','128k',
        '-f', 'mpegts', 'udp://239.0.0.1:1234?pkt_size=1316&ttl=128'
    ) -WindowStyle Hidden -PassThru

    $u2 = Start-Process ffmpeg -ArgumentList @(
        '-hide_banner','-loglevel','warning',
        '-f','dshow','-video_size','1280x720','-framerate','30',
        '-i',"video=`"$Webcam`"",
        '-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
        '-b:v','3M','-pix_fmt','yuv420p','-g','60','-an',
        '-f', 'mpegts', 'udp://239.0.0.2:1234?pkt_size=1316&ttl=128'
    ) -WindowStyle Hidden -PassThru

    $allPids += $u1.Id,$u2.Id
    Write-Host "UDP  CH1:$($u1.Id) CH2:$($u2.Id)" -ForegroundColor DarkGray
}

$allPids | ConvertTo-Json | Set-Content $PidFile

if ($doHls) {
    Write-Host "Waiting for HLS segments..." -ForegroundColor DarkGray
    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path "$HlsRoot\ch1\stream.m3u8") -and (Test-Path "$HlsRoot\ch2\stream.m3u8")) { break }
        Start-Sleep -Milliseconds 500
    }
    $ok = (Test-Path "$HlsRoot\ch1\stream.m3u8") -and (Test-Path "$HlsRoot\ch2\stream.m3u8")
    Write-Host "HLS ready: $(if ($ok) {'Yes'} else {'NO — check ffmpeg/webcam'})" -ForegroundColor $(if ($ok) {'Green'} else {'Red'})
}
if ($doUdp) { Write-Host "UDP streaming on 239.0.0.1:1234 and 239.0.0.2:1234" -ForegroundColor Green }

Write-Host "`nPress Enter to stop  (or from another terminal: .\tools\stream-iptv-test.ps1 -Stop)" -ForegroundColor Red
$null = Read-Host

$n = Stop-IptvStreams
if ($doHls) { Remove-Item $HlsRoot -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "Stopped $n process(es)." -ForegroundColor Yellow

