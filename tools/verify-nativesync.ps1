$file = "c:\Users\chiho\Projects\Platform\apps\nexari-tizen\src\player.ts"
$bytes = [System.IO.File]::ReadAllBytes($file)
$content = [System.Text.Encoding]::UTF8.GetString($bytes)

# Find the start of the big comment block inside _startNativeSyncPlay
$startMarker = "    // -- Rect & rotation"
$startIdx = $content.IndexOf($startMarker)
if ($startIdx -lt 0) { Write-Error "startMarker not found"; exit 1 }

# Find end: just before the catch block close and method close
$endMarker = "      logger.warn('[NativeSync] startSyncPlay threw: '"
$endIdx = $content.IndexOf($endMarker, $startIdx)
if ($endIdx -lt 0) { Write-Error "endMarker not found"; exit 1 }

# Find the full end including the catch + closing braces of _startNativeSyncPlay
$closingMarker = "  // Stop and clear any active firmware SyncPlay session."
$closingIdx = $content.IndexOf($closingMarker, $endIdx)
if ($closingIdx -lt 0) { Write-Error "closingMarker not found"; exit 1 }

# The old block spans from startMarker to just before closingMarker (including the closing  },)
# We need everything from startMarker up to (but not including) closingMarker
$oldBlock = $content.Substring($startIdx, $closingIdx - $startIdx)
Write-Host ("Old block length: " + $oldBlock.Length)
Write-Host "--- OLD START ---"
Write-Host $oldBlock.Substring(0, 200)
Write-Host "--- OLD END ---"
Write-Host $oldBlock.Substring($oldBlock.Length - 150)
