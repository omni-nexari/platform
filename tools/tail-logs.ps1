$qbc = "2a949e66-a900-4684-b586-34cd37cf3947"
$td  = "1ed6367a-0c18-490f-af65-7f6a990141b2"
$sql = "SELECT to_char(created_at,'HH24:MI:SS') as t, device_id, level, message FROM log_entries WHERE device_id IN ('$qbc','$td') ORDER BY id DESC LIMIT 80"
$output = ssh -p 5551 chiho@192.168.1.17 "PGPASSWORD=Scatter@2026! psql -U signage -h 127.0.0.1 -d ds -t --no-align -c `"$sql`""
$output | ForEach-Object {
    $parts = $_ -split '\|'
    if ($parts.Count -ge 4) {
        $dev = if ($parts[1].Trim() -eq $qbc) { 'QBC' } else { '3D' }
        "$($parts[0].Trim()) [$dev] $($parts[2].Trim().ToUpper()) $($parts[3].Trim())"
    }
}
