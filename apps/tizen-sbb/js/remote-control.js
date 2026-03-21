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
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    MENU: 18,
    INFO: 457,
    TOOLS: 10135,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
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
      if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
        // Navigation keys (arrows, enter, return) work by default without registration
        // Only try to register special keys that require explicit permission
        
        // Get list of supported keys
        const supportedKeys = tizen.tvinputdevice.getSupportedKeys();
        logger.debug(`Supported input keys: ${supportedKeys.length} keys available`);
        
        // Try to register Info/Tools key for debug display
        const keysToRegister = [
          'Info',      // Info button
          'Tools',     // Tools/Settings button  
          'Exit',      // Exit button
        ];

        keysToRegister.forEach(key => {
          try {
            tizen.tvinputdevice.registerKey(key);
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

    // When log console is open, UP/DOWN scroll it and INFO closes it
    if (typeof UiLog !== 'undefined' && UiLog._visible) {
      if (keyCode === this.KEYS.UP || keyCode === this.KEYS.DOWN) {
        var logList = document.getElementById('ui-log-list');
        if (logList) {
          logList.scrollTop += keyCode === this.KEYS.DOWN ? 120 : -120;
        }
        return;
      }
      if (keyCode === this.KEYS.INFO) {
        UiLog.toggle();
        return;
      }
    }

    // INFO button opens the log console when it is closed
    if (keyCode === this.KEYS.INFO) {
      if (typeof UiLog !== 'undefined') UiLog.toggle();
      return;
    }

    // Handle key presses based on current screen
    const activeScreen = this.getCurrentScreen();

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

  handlePairingScreenKeys(keyCode, event) {
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
    switch (keyCode) {
      case this.KEYS.RETURN:
        // Back button - show device info overlay
        event.preventDefault();
        this.toggleStatusOverlay();
        break;

      case this.KEYS.EXIT:
        // Exit button - confirm exit
        event.preventDefault();
        this.confirmExit();
        break;

      case this.KEYS.ENTER:
        // Enter button - close debug overlay if open
        event.preventDefault();
        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay && debugOverlay.style.display !== 'none') {
          debugOverlay.style.display = 'none';
        }
        break;

      case this.KEYS.UP:
      case this.KEYS.DOWN:
      case this.KEYS.LEFT:
      case this.KEYS.RIGHT:
        // Navigation keys - log for debugging
        const directions = { 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' };
        logger.debug(`Navigation: ${directions[keyCode]}`);
        break;

      case this.KEYS.PLAY:
        // Play button - resume content if paused
        logger.info('Play button pressed');
        this.sendRemoteCommand('PLAY');
        break;

      case this.KEYS.PAUSE:
        // Pause button
        logger.info('Pause button pressed');
        this.sendRemoteCommand('PAUSE');
        break;

      case this.KEYS.STOP:
        // Stop button - reload content
        logger.info('Stop button pressed');
        this.sendRemoteCommand('STOP');
        break;

      case this.KEYS.REWIND:
        logger.info('Rewind button pressed');
        this.sendRemoteCommand('REWIND');
        break;

      case this.KEYS.FAST_FORWARD:
        logger.info('Fast forward button pressed');
        this.sendRemoteCommand('FAST_FORWARD');
        break;
    }
  },

  handleErrorScreenKeys(keyCode, event) {
    switch (keyCode) {
      case this.KEYS.ENTER:
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
    if (confirm('Exit Digital Signage Player?')) {
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
    
    // Show notification
    this.showNotification(`Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}`);
  },

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
      var connected = false;
      if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
        connected = navigator.onLine;
      }
      apiStatus.textContent = connected ? 'Network reachable' : 'Network offline';
    }
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
