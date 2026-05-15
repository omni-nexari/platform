$file = "c:\Users\chiho\Projects\Platform\apps\nexari-tizen\src\player.ts"
$bytes = [System.IO.File]::ReadAllBytes($file)
$content = [System.Text.Encoding]::UTF8.GetString($bytes)

$startMarker = "    // Defensive cleanup: only clearSyncPlayList"
$endMarker = "`n  // Start the on-TV Node relay"

$startIdx = $content.IndexOf($startMarker)
$endIdx   = $content.IndexOf($endMarker)

if ($startIdx -lt 0) { Write-Error "startMarker not found"; exit 1 }
if ($endIdx   -lt 0) { Write-Error "endMarker not found";   exit 1 }

$oldBlock = $content.Substring($startIdx, $endIdx - $startIdx)
Write-Host ("Replacing block of " + $oldBlock.Length + " chars at idx=" + $startIdx)

$newBlock = @'
    // Sequential teardown -> rebuild -> start prevents "Can't register callback".
    // stopSyncPlay unregisters any live firmware onChange from a previous session
    // (including ghost sessions after a page reload). clearSyncPlayList resets the
    // playlist. Only after both complete do we call makeSyncPlayList + startSyncPlay.
    // Per-step fallback timeouts prevent stalls if a callback never fires.
    let cleared = false;
    const doClear = (reason: string) => {
      if (cleared) return;
      cleared = true;
      logger.info('[NativeSync] doClear (' + reason + ') -> clearSyncPlayList');
      let started = false;
      const begin = (r: string) => {
        if (started) return;
        started = true;
        logger.info('[NativeSync] begin (' + r + ') -> makeSyncPlayList');
        startNativeSync();
      };
      try {
        api.clearSyncPlayList(
          () => { logger.info('[NativeSync] clearSyncPlayList ok'); begin('clear-ok'); },
          () => { logger.warn('[NativeSync] clearSyncPlayList err'); begin('clear-err'); },
        );
      } catch (e: any) {
        logger.warn('[NativeSync] clearSyncPlayList threw: ' + (e?.message || e));
        begin('clear-throw');
      }
      setTimeout(() => begin('clear-timeout'), 500);
    };
    // Always stop first: unregisters any live onChange callback in the firmware.
    try {
      api.stopSyncPlay(
        () => { logger.info('[NativeSync] stopSyncPlay ok'); setTimeout(() => doClear('stop-ok'), 50); },
        () => { logger.warn('[NativeSync] stopSyncPlay err'); doClear('stop-err'); },
      );
    } catch (e: any) {
      logger.warn('[NativeSync] stopSyncPlay threw: ' + (e?.message || e));
      doClear('stop-throw');
    }
    setTimeout(() => doClear('stop-timeout'), 600);
  },

'@

$newContent = $content.Substring(0, $startIdx) + $newBlock + $content.Substring($endIdx + 1)
[System.IO.File]::WriteAllText($file, $newContent, [System.Text.Encoding]::UTF8)
Write-Host "Done. New file length: $($newContent.Length)"
