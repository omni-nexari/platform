// Main Application Entry Point

(function() {
  'use strict';

  logger.info('Digital Signage Player starting...');
  logger.info('API Base:', CONFIG.API_BASE);
  logger.info('WebSocket URL:', CONFIG.WS_URL);

  // Initialize content manager
  ContentManager.init().catch(error => {
    logger.error('Failed to initialize content manager:', error);
  });

  // Initialize hardware control layer
  if (typeof TVControl !== 'undefined' && typeof TVControl.init === 'function') {
    try {
      TVControl.init();
    } catch (error) {
      logger.warn('TVControl initialization failed:', error);
    }
  }

  // Initialize remote control handler
  RemoteControl.init();

  // Telemetry overlay toggle (press INFO button on remote)
  let telemetryVisible = false;
  window.toggleTelemetry = async function() {
    telemetryVisible = !telemetryVisible;
    const overlay = document.getElementById('telemetry-overlay');
    
    if (telemetryVisible) {
      overlay.classList.add('visible');
      await updateTelemetryDisplay();
    } else {
      overlay.classList.remove('visible');
    }
  };

  // Update telemetry overlay with current data
  window.updateTelemetryDisplay = async function() {
    try {
      const systemInfo = await Telemetry.getSystemInfo();
      
      document.getElementById('telem-model').textContent = systemInfo.model || '--';
      document.getElementById('telem-serial').textContent = systemInfo.serialNumber || '--';
      document.getElementById('telem-panel').textContent = systemInfo.panelType || '--';
      document.getElementById('telem-ip').textContent = systemInfo.ipAddress || '--';
      document.getElementById('telem-network').textContent = systemInfo.networkType || '--';
      
      if (systemInfo.memoryFree && systemInfo.memoryTotal) {
        const memUsedGB = ((systemInfo.memoryTotal - systemInfo.memoryFree) / 1024 / 1024 / 1024).toFixed(1);
        const memTotalGB = (systemInfo.memoryTotal / 1024 / 1024 / 1024).toFixed(1);
        document.getElementById('telem-memory').textContent = `${memUsedGB}/${memTotalGB} GB`;
      }
      
      if (systemInfo.storageFree && systemInfo.storageTotal) {
        const storageUsedGB = ((systemInfo.storageTotal - systemInfo.storageFree) / 1024 / 1024 / 1024).toFixed(1);
        const storageTotalGB = (systemInfo.storageTotal / 1024 / 1024 / 1024).toFixed(1);
        document.getElementById('telem-storage').textContent = `${storageUsedGB}/${storageTotalGB} GB`;
      }
      
      if (systemInfo.uptime) {
        const hours = Math.floor(systemInfo.uptime / 3600);
        const minutes = Math.floor((systemInfo.uptime % 3600) / 60);
        document.getElementById('telem-uptime').textContent = `${hours}h ${minutes}m`;
      }
      
      if (systemInfo.cpuLoad) {
        document.getElementById('telem-cpu').textContent = `${(systemInfo.cpuLoad * 100).toFixed(1)}%`;
      }
      
      // Player status info
      if (typeof Player !== 'undefined') {
        // Current playlist
        const playlistName = (Player.currentContent && Player.currentContent.playlistName) || (Player.currentContent && Player.currentContent.name) || 'None';
        const itemCount = (Player.currentContent && Player.currentContent.items && Player.currentContent.items.length) || 0;
        document.getElementById('telem-playlist').textContent = itemCount > 0 ? `${playlistName} (${itemCount} items)` : playlistName;
        
        // Playback status
        let playbackStatus = 'Idle';
        if (Player.isSyncPlaying) {
          playbackStatus = 'Sync Play';
        } else if (Player.currentItem) {
          const itemIndex = Player.currentIndex + 1;
          const totalItems = (Player.currentPlaylist && Player.currentPlaylist.items && Player.currentPlaylist.items.length) || 0;
          playbackStatus = totalItems > 0 ? `Playing ${itemIndex}/${totalItems}` : 'Playing';
        }
        document.getElementById('telem-playback').textContent = playbackStatus;
        
        // Download progress
        let downloadText = 'Not downloading';
        if (Player.isDownloadingContent) {
          const progress = Player.lastDownloadProgress || 0;
          downloadText = `${progress}%`;
          if (progress < 100) {
            downloadText += ' - In progress';
          } else {
            downloadText += ' - Complete';
          }
        } else if (Player.pendingPlaylist) {
          downloadText = '100% - Ready to swap';
        }
        document.getElementById('telem-download').textContent = downloadText;
      }
    } catch (error) {
      logger.error('Failed to update telemetry display:', error);
    }
  };

  // Check if device is already paired
  const isPaired = localStorage.getItem('isPaired') === 'true';
  const deviceId = localStorage.getItem('deviceId');
  const deviceName = localStorage.getItem('deviceName');

  if (isPaired && deviceId) {
    logger.info('Device already paired:', deviceName);
    
    // Start player directly
    Player.init({
      id: deviceId,
      name: deviceName,
      workspaceId: localStorage.getItem('workspaceId')
    });
    
  } else {
    logger.info('Device not paired, starting pairing process');
    
    // Start pairing process
    Pairing.init();
  }

  // Handle Tizen app lifecycle
  window.addEventListener('tizenhwkey', function(e) {
    if (e.keyName === 'back') {
      try {
        // Prevent back button from exiting the app
        logger.debug('Back button pressed - ignoring');
        e.preventDefault();
      } catch (error) {
        logger.error('Error handling back button:', error);
      }
    }
  });

  // Handle app visibility changes
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      logger.info('App hidden');
    } else {
      logger.info('App visible');
      // Refresh content when app becomes visible
      if (Player.deviceId) {
        Player.loadContent();
      }
    }
  });

  // Handle page unload
  window.addEventListener('beforeunload', function() {
    logger.info('App closing...');
    if (Player.destroy) {
      Player.destroy();
    }
    if (Pairing.stopPairingCheck) {
      Pairing.stopPairingCheck();
    }
  });

  // Global error handler
  window.addEventListener('error', function(e) {
    logger.error('Uncaught error:', e.error || e.message);
  });

  window.addEventListener('unhandledrejection', function(e) {
    logger.error('Unhandled promise rejection:', e.reason);
  });

  logger.info('Application initialized');

})();
