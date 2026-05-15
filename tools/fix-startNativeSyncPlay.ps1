$file = "c:\Users\chiho\Projects\Platform\apps\nexari-tizen\src\player.ts"
$bytes = [System.IO.File]::ReadAllBytes($file)
$content = [System.Text.Encoding]::UTF8.GetString($bytes)

$startMarker = "    // -- Rect & rotation"
$startIdx = $content.IndexOf($startMarker)
if ($startIdx -lt 0) { Write-Error "startMarker not found"; exit 1 }

$closingMarker = "  // Stop and clear any active firmware SyncPlay session."
$closingIdx = $content.IndexOf($closingMarker, $startIdx)
if ($closingIdx -lt 0) { Write-Error "closingMarker not found"; exit 1 }

$oldBlock = $content.Substring($startIdx, $closingIdx - $startIdx)

$newBlock = @'
    // -- Rect & rotation -------------------------------------------------
    // b2bsyncplay uses CENTER-ORIGIN coordinates in PHYSICAL panel pixels:
    //   posX = -(panelW/2), posY = -(panelH/2), width = panelW, height = panelH
    //
    // Use _getSyncPlayRect() which reads _physicalPanelWidth/Height (set at
    // init from tizen.systeminfo DISPLAY). This avoids wrong rects from
    // window.innerWidth/innerHeight, which report swapped CSS dimensions on
    // portrait-mounted Tizen 7+ panels (e.g. 1080x1920 on a landscape FHD).
    //
    // speed=1 for normal sync (5/7 are only for videowall rotation modes).
    // rotation='OFF': CMS supplies pre-rotated assets for portrait layouts.

    const rotation = 'OFF';
    const { x: rectX, y: rectY, w: rectW, h: rectH } = this._getSyncPlayRect();
    try {
      logger.info('[NativeSync] startSyncPlay rect=' + rectX + ',' + rectY + ',' + rectW + ',' + rectH + ' groupID=' + groupId);
      const handle = api.startSyncPlay(rectX, rectY, rectW, rectH, 1, rotation, onChange);
      this._nativeSyncActive = true;
      this._nativeSyncGroupId = groupId;
      logger.info('[NativeSync] startSyncPlay invoked (groupID=' + groupId + ', handle=' + handle + ')');
    } catch (e: any) {
      logger.warn('[NativeSync] startSyncPlay threw: ' + (e?.message || e));
      this._nativeSyncActive = false;
      this._nativeSyncGroupId = null;
      this.setAvPlayVisualMode(false);
    }
  },

'@

$newContent = $content.Substring(0, $startIdx) + $newBlock + $content.Substring($closingIdx)
[System.IO.File]::WriteAllText($file, $newContent, [System.Text.Encoding]::UTF8)
Write-Host "Done. New file length: $($newContent.Length)"
