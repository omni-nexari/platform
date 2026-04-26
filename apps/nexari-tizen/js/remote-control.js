// Remote Control Handler for Samsung Tizen TV
// Handles TV remote button presses for navigation and control

window.RemoteControl = {
  // Key codes for Samsung TV remote
  KEYS: {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    ENTER: 13,
    RETURN: 10009, // Back button
    EXIT: 10182,
    MENU: 18,
    INFO: 457,
    TOOLS: 10135,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
    NUM_1: 49,
    NUM_2: 50,
    NUM_3: 51,
    NUM_4: 52,
    NUM_5: 53,
    NUM_6: 54,
    NUM_7: 55,
    NUM_8: 56,
    NUM_9: 57,
    NUM_0: 48,
    CHANNEL_UP: 427,
    CHANNEL_DOWN: 428,
    VOLUME_UP: 447,
    VOLUME_DOWN: 448,
    MUTE: 449,
  },

  // Current state
  debugMode: false,
  enabled: true,

  init() {
    logger.info('Initializing remote control handler');
    
    // Register key event listener
    document.addEventListener('keydown', this.handleKeyPress.bind(this));
    
    // Register keys with Tizen TV input device
    this.registerTizenKeys();
    
    logger.info('Remote control handler initialized');
  },

  registerTizenKeys() {
    try {
      // On SSSP (older platform) tvinputdevice lives under b2bapis; on newer Tizen it's tizen.tvinputdevice
      const inputDevice =
        (typeof tizen !== 'undefined' && tizen.tvinputdevice)
          ? tizen.tvinputdevice
          : (typeof b2bapis !== 'undefined' && b2bapis.tvinputdevice)
            ? b2bapis.tvinputdevice
            : null;

      if (inputDevice) {
        // Navigation keys (arrows, enter, return) work by default without registration
        // Only try to register special keys that require explicit permission

        // Get list of supported keys
        const supportedKeys = inputDevice.getSupportedKeys();
        const supportedKeyNames = supportedKeys.map(function(k) { return k.name; });
        logger.info('Supported input keys (' + supportedKeys.length + '): ' + supportedKeyNames.join(', '));

        const keysToRegister = [
          'Info',
          // 'Menu' intentionally NOT registered — registerKey() steals Menu from
          // the TV firmware (OSD), preventing both physical remote and MDC VRC
          // (0xB0 0x1A) from opening the TV menu. Let the firmware handle it natively.
          'Tools',
          'Exit',
          'VolumeUp',
          'VolumeDown',
          'VolumeMute',
          'ChannelUp',
          'ChannelDown',
          'ColorF0Red',
          'ColorF1Green',
          'ColorF2Yellow',
          'ColorF3Blue',
          'MediaPlayPause',
          '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        ];

        keysToRegister.forEach(key => {
          try {
            inputDevice.registerKey(key);
            logger.debug(`Registered key: ${key}`);
          } catch (e) {
            logger.debug(`Could not register key ${key}:`, e.message);
          }
        });

        logger.debug('Tizen input device keys registered');
      }
    } catch (error) {
      logger.debug('Tizen TV input device not available:', error.message);
    }
  },

  handleKeyPress(event) {
    if (!this.enabled) return;

    const keyCode = event.keyCode;
    const activeScreen = this.getCurrentScreen();
    
    if (this.debugMode) {
      logger.debug(`Key pressed: ${keyCode}`);
    }

    // Prevent default behavior for navigation keys
    if ([this.KEYS.LEFT, this.KEYS.RIGHT, this.KEYS.UP, this.KEYS.DOWN].includes(keyCode)) {
      event.preventDefault();
      event.stopPropagation();
    }

    // TOOLS button toggles the tools/status overlay on any screen
    if (keyCode === this.KEYS.TOOLS) {
      this.toggleToolsOverlay();
      return;
    }

    // When log console is open, INFO closes it, UP/DOWN scroll, LEFT/RIGHT/ENTER control filter buttons
    if (typeof UiLog !== 'undefined' && UiLog._visible) {
      if (keyCode === this.KEYS.INFO) {
        UiLog.toggle();
        return;
      }
      if (keyCode === this.KEYS.UP) {
        UiLog.scrollOlder();
        return;
      }
      if (keyCode === this.KEYS.DOWN) {
        UiLog.scrollNewer();
        return;
      }
      if (keyCode === this.KEYS.LEFT) {
        UiLog.moveControl(-1);
        return;
      }
      if (keyCode === this.KEYS.RIGHT) {
        UiLog.moveControl(1);
        return;
      }
      if (keyCode === this.KEYS.ENTER) {
        UiLog.activateControl();
        return;
      }
    }

    // INFO button opens the log console when it is closed
    if (keyCode === this.KEYS.INFO) {
      if (typeof UiLog !== 'undefined') UiLog.toggle();
      return;
    }

    // Blue button (ColorF3Blue) also toggles log console (fallback when INFO key not firing)
    if (keyCode === this.KEYS.BLUE) {
      if (typeof UiLog !== 'undefined') UiLog.toggle();
      return;
    }

    // Log all unhandled key presses for diagnostics
    logger.debug('Unhandled key: ' + keyCode);

    if (this.handleGlobalShortcut(keyCode, activeScreen, event)) {
      return;
    }

    switch (activeScreen) {
      case 'pairing':
        this.handlePairingScreenKeys(keyCode, event);
        break;
      case 'player':
        this.handlePlayerScreenKeys(keyCode, event);
        break;
      case 'error':
        this.handleErrorScreenKeys(keyCode, event);
        break;
    }
  },

  getCurrentScreen() {
    if (!document.getElementById('pairing-screen').classList.contains('hidden')) {
      return 'pairing';
    } else if (!document.getElementById('player-screen').classList.contains('hidden')) {
      return 'player';
    } else if (!document.getElementById('error-screen').classList.contains('hidden')) {
      return 'error';
    }
    return 'unknown';
  },

  handleGlobalShortcut(keyCode, activeScreen, event) {
    // When an IPTV channel group is playing, digit keys 0-9 are reserved for
    // direct channel tuning and must NOT trigger NUM_2/NUM_4 shortcuts.
    const channelGroupActive = (
      typeof Player !== 'undefined' &&
      Player.currentChannelGroup &&
      activeScreen === 'player'
    );
    if (channelGroupActive && keyCode >= this.KEYS.NUM_0 && keyCode <= this.KEYS.NUM_9) {
      return false;
    }

    switch (keyCode) {
      case this.KEYS.NUM_4:
        event.preventDefault();
        logger.info('Navigating to test-tizen.html via NUM_4');
        window.location.href = 'test-tizen.html';
        return true;

      case this.KEYS.NUM_2:
        event.preventDefault();
        if (activeScreen === 'pairing') {
          if (typeof Pairing !== 'undefined' && Pairing.init) {
            logger.info('Manual pairing retry triggered');
            Pairing.init();
          }
        } else if (typeof Player !== 'undefined' && Player.loadContent) {
          logger.info('Force content refresh');
          Player.loadContent();
        }
        return true;

      case this.KEYS.NUM_3:
        event.preventDefault();
        if (typeof Player !== 'undefined' && Player.sendWebSocketHeartbeat) {
          logger.info('Manual heartbeat');
          Player.sendWebSocketHeartbeat();
        }
        return true;

      case this.KEYS.YELLOW:
        event.preventDefault();
        this.toggleDebugMode();
        return true;

      default:
        return false;
    }
  },

  handlePairingScreenKeys(keyCode, event) {
    // IPTV channel-group tuning: CH+/CH- and direct digit input.
    if (typeof Player !== 'undefined' && Player.currentChannelGroup) {
      if (keyCode === this.KEYS.CHANNEL_UP) {
        event.preventDefault();
        if (Player.nextChannel) Player.nextChannel();
        return;
      }
      if (keyCode === this.KEYS.CHANNEL_DOWN) {
        event.preventDefault();
        if (Player.prevChannel) Player.prevChannel();
        return;
      }
      if (keyCode >= this.KEYS.NUM_0 && keyCode <= this.KEYS.NUM_9) {
        event.preventDefault();
        if (Player.bufferDigit) Player.bufferDigit(keyCode - this.KEYS.NUM_0);
        return;
      }
    }

    switch (keyCode) {
      case this.KEYS.RETURN:
      case this.KEYS.EXIT:
        // Back button - exit app
        event.preventDefault();
        this.confirmExit();
        break;
    }
  },

  handlePlayerScreenKeys(keyCode, event) {
    // IPTV channel-group tuning: CH+/CH- and direct digit input.
    if (typeof Player !== 'undefined' && Player.currentChannelGroup) {
      if (keyCode === this.KEYS.CHANNEL_UP) {
        event.preventDefault();
        if (Player.nextChannel) Player.nextChannel();
        return;
      }
      if (keyCode === this.KEYS.CHANNEL_DOWN) {
        event.preventDefault();
        if (Player.prevChannel) Player.prevChannel();
        return;
      }
      if (keyCode >= this.KEYS.NUM_0 && keyCode <= this.KEYS.NUM_9) {
        event.preventDefault();
        if (Player.bufferDigit) Player.bufferDigit(keyCode - this.KEYS.NUM_0);
        return;
      }
    }

    switch (keyCode) {
      case this.KEYS.RETURN:
        // Back button - show status bar
        event.preventDefault();
        this.toggleStatusOverlay();
        break;

      case this.KEYS.EXIT:
        // Exit button - confirm exit
        event.preventDefault();
        this.confirmExit();
        break;

      case this.KEYS.UP:
      case this.KEYS.DOWN:
      case this.KEYS.LEFT:
      case this.KEYS.RIGHT:
        // Navigation keys
        const directions = { 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' };
        logger.debug(`Navigation: ${directions[keyCode]}`);
        break;
    }
  },

  handleErrorScreenKeys(keyCode, event) {
    switch (keyCode) {
      case this.KEYS.ENTER:
      case this.KEYS.RED:
        // Retry button
        const retryBtn = document.getElementById('retry-button');
        if (retryBtn) {
          retryBtn.click();
        }
        break;

      case this.KEYS.RETURN:
      case this.KEYS.EXIT:
        // Exit app
        event.preventDefault();
        this.confirmExit();
        break;
    }
  },

  sendRemoteCommand(command) {
    // Send command to backend if player is connected
    if (typeof Player !== 'undefined' && Player.wsConnection && Player.wsConnection.readyState === WebSocket.OPEN) {
      Player.wsConnection.send(JSON.stringify({
        type: 'REMOTE_COMMAND',
        command: command,
        timestamp: Date.now(),
      }));
    }
  },

  confirmExit() {
    if (confirm('Exit Nexari Player?')) {
      try {
        tizen.application.getCurrentApplication().exit();
      } catch (error) {
        logger.error('Failed to exit app:', error);
      }
    }
  },

  toggleDebugMode() {
    this.debugMode = !this.debugMode;
    if (CONFIG && CONFIG.DEBUG !== undefined) {
      CONFIG.DEBUG = this.debugMode;
    }
    logger.info('Debug mode:', this.debugMode ? 'ON' : 'OFF');
    this.showNotification(`Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}`);
  },

  // Delegates to tools overlay
  toggleDebugOverlay() {
    this.toggleToolsOverlay();
  },

  updateDebugOverlay() {
    this.updateToolsOverlay();
  },

  toggleToolsOverlay() {
    var overlay = document.getElementById('tools-overlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden');
    if (!overlay.classList.contains('hidden')) {
      this.updateToolsOverlay();
      if (this.toolsUpdateInterval) clearInterval(this.toolsUpdateInterval);
      this.toolsUpdateInterval = setInterval(this.updateToolsOverlay.bind(this), 3000);
    } else if (this.toolsUpdateInterval) {
      clearInterval(this.toolsUpdateInterval);
      this.toolsUpdateInterval = null;
    }
  },

  updateToolsOverlay() {
    var apiUrl = document.getElementById('tools-api-url');
    var apiStatus = document.getElementById('tools-api-status');
    var wsStatus = document.getElementById('tools-ws-status');
    if (apiUrl) apiUrl.textContent = CONFIG.API_BASE || '--';

    if (wsStatus) {
      var state = 'DISCONNECTED';
      if (typeof Player !== 'undefined' && Player.wsConnection) {
        var states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        state = states[Player.wsConnection.readyState] || 'UNKNOWN';
      }
      wsStatus.textContent = state;
    }

    if (apiStatus) {
      var connected = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine : true;
      apiStatus.textContent = connected ? 'Network reachable' : 'Network offline';
    }
  },

  toggleRemoteOverlay() {
    var overlay = document.getElementById('remote-overlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden');
    logger.debug('Remote overlay:', overlay.classList.contains('hidden') ? 'hidden' : 'shown');
  },

  toggleStatusOverlay() {
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
      statusBar.style.display = statusBar.style.display === 'none' ? 'flex' : 'none';
    }
  },

  showDeviceInfo() {
    // Show device information overlay
    const deviceInfo = {
      name: (document.getElementById('device-name') && document.getElementById('device-name').textContent) || 'Unknown',
      status: (document.getElementById('connection-status') && document.getElementById('connection-status').textContent) || 'Unknown',
    };

    const infoText = `Device: ${deviceInfo.name}\nStatus: ${deviceInfo.status}`;
    this.showNotification(infoText, 3000);
  },

  showConnectionStatus() {
    if (typeof Player !== 'undefined' && Player.wsConnection) {
      const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      const state = states[Player.wsConnection.readyState] || 'UNKNOWN';
      this.showNotification(`WebSocket: ${state}`);
    }
  },

  showNotification(message, duration = 2000, style = 'cyberpunk') {
    // Create or update notification overlay with theme-specific styling
    let notification = document.getElementById('remote-notification');
    
    const isGlass = style === 'glassmorphism';
    
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'remote-notification';
      notification.className = isGlass ? 'glass-notification' : 'cyber-notification';
      notification.style.cssText = isGlass ? `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(255, 255, 255, 0.12);
        color: #1e293b;
        padding: 15px 25px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        white-space: pre-line;
        max-width: 400px;
        box-shadow: 
          0 8px 32px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        animation: glass-toast-enter 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      ` : `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(26, 15, 31, 0.95);
        color: #f72585;
        padding: 15px 25px;
        border: 1px solid #ff00ff;
        border-radius: 4px;
        font-family: 'Courier New', 'Roboto Mono', monospace;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        z-index: 10000;
        white-space: pre-line;
        max-width: 400px;
        box-shadow: 
          0 0 20px rgba(255, 0, 255, 0.4),
          inset 0 0 10px rgba(255, 0, 255, 0.2);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        clip-path: polygon(
          0 0,
          calc(100% - 12px) 0,
          100% 12px,
          100% 100%,
          12px 100%,
          0 calc(100% - 12px)
        );
        animation: cyber-toast-enter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      `;
      
      if (!isGlass) {
        // Add corner bracket for cyberpunk
        const corner = document.createElement('div');
        corner.style.cssText = `
          position: absolute;
          top: 0;
          right: 0;
          width: 12px;
          height: 12px;
          border-top: 2px solid #ff00ff;
          border-right: 2px solid #ff00ff;
          opacity: 0.7;
        `;
        notification.appendChild(corner);
        
        // Add scan line effect for cyberpunk
        const scanline = document.createElement('div');
        scanline.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 2px;
          background: linear-gradient(90deg,
            transparent 0%,
            #00ffff 50%,
            transparent 100%
          );
          opacity: 0.5;
          animation: toast-scan 2s linear infinite;
        `;
        notification.appendChild(scanline);
      } else {
        // Add shimmer effect for glassmorphism
        const shimmer = document.createElement('div');
        shimmer.style.cssText = `
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(255, 255, 255, 0.15) 50%,
            transparent 70%
          );
          animation: glass-shimmer-move 3s infinite;
          pointer-events: none;
        `;
        notification.appendChild(shimmer);
      }
      
      // Add message container
      const messageContainer = document.createElement('div');
      messageContainer.id = 'notification-message';
      messageContainer.style.cssText = `
        position: relative;
        z-index: 1;
      `;
      notification.appendChild(messageContainer);
      
      document.body.appendChild(notification);
    }

    const messageContainer = notification.querySelector('#notification-message');
    if (messageContainer) {
      messageContainer.textContent = message;
    } else {
      notification.textContent = message;
    }
    
    notification.style.display = 'block';
    notification.style.opacity = '1';

    // Auto-hide with fade out
    const exitAnimation = isGlass ? 'glass-toast-exit' : 'cyber-toast-exit';
    const exitDuration = isGlass ? 400 : 300;
    
    setTimeout(() => {
      if (notification) {
        notification.style.animation = `${exitAnimation} ${exitDuration}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`;
        setTimeout(() => {
          if (notification) {
            notification.style.display = 'none';
          }
        }, exitDuration);
      }
    }, duration);
  },

  // Show typed notifications (success, error, warning, info)
  showTypedNotification(message, type = 'info', duration = 2000, style = 'cyberpunk') {
    const notification = document.getElementById('remote-notification');
    
    const isGlass = style === 'glassmorphism';
    
    if (notification) {
      // Update notification class for type-specific styling
      notification.className = isGlass 
        ? `glass-notification ${type}` 
        : `cyber-notification ${type}`;
      
      // Update colors based on type
      const colors = {
        success: { border: '#00ff41', text: '#00ff41', shadow: 'rgba(0, 255, 65, 0.4)' },
        error: { border: '#ff006e', text: '#ff006e', shadow: 'rgba(255, 0, 110, 0.4)' },
        warning: { border: '#ffbe0b', text: '#ffbe0b', shadow: 'rgba(255, 190, 11, 0.4)' },
        info: { border: '#00ffff', text: '#00ffff', shadow: 'rgba(0, 255, 255, 0.4)' },
      };
      
      const color = colors[type] || colors.info;
      notification.style.borderColor = color.border;
      notification.style.color = color.text;
      notification.style.boxShadow = `
        0 0 20px ${color.shadow},
        inset 0 0 10px ${color.shadow}
      `;
      
      // Update corner bracket color
      const corner = notification.querySelector('div');
      if (corner && corner.style.position === 'absolute') {
        corner.style.borderTopColor = color.border;
        corner.style.borderRightColor = color.border;
      }
    }
    
    this.showNotification(message, duration);
  },

  enable() {
    this.enabled = true;
    logger.info('Remote control enabled');
  },

  disable() {
    this.enabled = false;
    logger.info('Remote control disabled');
  },
};
