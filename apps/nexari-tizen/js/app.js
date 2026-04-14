// Main Application Entry Point

(function() {
  'use strict';

  logger.info('Nexari Player starting...');
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
  const deviceToken = localStorage.getItem('deviceToken');
  const workspaceId = localStorage.getItem('workspaceId');

  // Start local MDC bridge — Samsung B2B API launches a real Node.js process
  // on the TV OS that listens on 127.0.0.1:9615 and forwards MDC commands to
  // the panel firmware on 127.0.0.1:1515.
  function pickNodeServerFile() {
    // In development, use unsigned server.js (works on dev-mode TVs).
    // server.js is a thin stub that calls require('./js/mdc.js')().
    // All MDC logic is in js/mdc.js — update that freely without re-signing.
    if (typeof BUILD_PRODUCTION === 'undefined' || !BUILD_PRODUCTION) {
      return '../server.js';
    }
    // Production: each lib/server*.signed is an identical thin stub that calls
    // require('../js/mdc.js')() — signed separately per SSSP generation.
    // Submit lib/server.stub.js to Samsung SSSP portal to obtain each signed copy.
    var v = Platform.tizenMajor;
    if (v <= 2) return '../lib/server2016.js.signed'; // SSSP4 / Tizen 2.4
    if (v === 3) return '../lib/server2017.js.signed'; // SSSP5 / Tizen 3.0
    if (v === 4) return '../lib/server2018.js.signed'; // SSSP6 / Tizen 4.0
    if (v === 5) return '../lib/server2019.js.signed'; // SSSP7 / Tizen 5.0
    return '../lib/server2022.js.signed';              // SSSP8+ / Tizen 6.0+
  }

  if (typeof b2bapis !== 'undefined' && b2bapis.b2bcontrol &&
      typeof b2bapis.b2bcontrol.startNodeServer === 'function') {
    var serverFile = pickNodeServerFile();
    logger.info('[mdc-bridge] Starting Node server:', serverFile);
    b2bapis.b2bcontrol.startNodeServer(
      serverFile,
      'mdc-bridge',
      function() {
        logger.info('[mdc-bridge] Node server started on :9615');
        // Phase 1 MDC setup: set conn type RJ45, scan device ID, enable network standby
        setTimeout(function() {
          if (typeof Player !== 'undefined' && typeof Player.runStartupMdcSetup === 'function') {
            Player.runStartupMdcSetup();
          }
        }, 2000);
      },
      function(e) { logger.warn('[mdc-bridge] Failed to start Node server:', e && e.message); }
    );
  } else {
    logger.warn('[mdc-bridge] b2bcontrol.startNodeServer not available on this platform');
  }

  if (isPaired && deviceId && deviceToken) {
    logger.info('Device already paired:', deviceName);
    
    // Start player directly
    Player.init({
      id: deviceId,
      name: deviceName,
      deviceToken: deviceToken,
      workspaceId: workspaceId,
    });
    
  } else {
    if (isPaired && deviceId && !deviceToken) {
      logger.warn('Found paired device state without token, falling back to pairing flow');
    }
    logger.info('Device not paired, starting pairing process');
    
    // Start pairing process
    Pairing.init();
  }

  // Handle Tizen app lifecycle
  window.addEventListener('tizenhwkey', function(e) {
    if (e.keyName === 'back') {
      try {
        // Close remote overlay first if visible, then ignore
        var remoteOverlay = document.getElementById('remote-overlay');
        if (remoteOverlay && !remoteOverlay.classList.contains('hidden')) {
          remoteOverlay.classList.add('hidden');
          return;
        }
        logger.debug('Back button pressed - ignoring');
        e.preventDefault();
      } catch (error) {
        logger.error('Error handling back button:', error);
      }
    }
  });

  // Wire up on-screen remote overlay buttons
  document.addEventListener('DOMContentLoaded', function() {
    var rcBtns = document.querySelectorAll('.rc-btn[data-key]');
    rcBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.getAttribute('data-key');
        if (!key) return;
        if (typeof Player !== 'undefined' && Player.wsConnection && Player.wsConnection.readyState === WebSocket.OPEN) {
          Player.wsConnection.send(JSON.stringify({ type: 'remote_key', payload: { key: key } }));
          logger.debug('[rc-overlay] Sent remote_key:', key);
        } else if (key === 'POWER_OFF') {
          if (typeof TVControl !== 'undefined') TVControl.powerOff();
        } else if (key === 'POWER_ON') {
          if (typeof TVControl !== 'undefined') TVControl.powerOn();
        }
      });
    });
    var exitBtn = document.getElementById('rc-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', function() {
        try { tizen.application.getCurrentApplication().exit(); } catch (err) { logger.error('Exit failed:', err); }
      });
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
