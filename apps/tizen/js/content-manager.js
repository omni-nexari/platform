// Content Manager - Downloads and caches content to local storage
// Uses Tizen 5.0+ FileSystemManager / FileHandle API (deprecated File/FileStream removed)

window.ContentManager = {
  downloadQueue: [],
  downloading: false,
  storagePath: null,        // virtual path string e.g. 'wgt-private/content'
  htmlPackagesPath: null,   // virtual path string e.g. 'wgt-private/content/html-packages'
  // Legacy alias kept so player.js code that calls ContentManager.storageDir still works.
  // It is set to a thin shim object after init() succeeds.
  storageDir: null,
  backendBaseUrl: null,
  activeDownloads: new Map(), // Track Tizen download IDs
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024, // 10MB - use Tizen Download API for files larger than this (video files)
  cachedUrlMap: new Map(), // Map<contentId, fileUri>

  // Initialize content manager
  async init() {
    try {
      await this.ensureStoragePath();
      await this.ensureHtmlPackagesPath();
      // Shim so legacy ContentManager.storageDir.resolve(name) in player.js still works
      this.storageDir = {
        resolve: (name) => {
          const p = this.storagePath + '/' + name;
          if (!tizen.filesystem.pathExists(p)) throw new Error('NotFoundError: ' + p);
          return { _path: p, fullPath: p, name: name,
            fileSize: this._getFileSize(p),
            toURI: () => tizen.filesystem.toURI(p),
            openStream: (mode, onSuccess, onError) => this._openStreamShim(p, mode, onSuccess, onError)
          };
        }
      };
      logger.info('Content manager initialized');
    } catch (error) {
      logger.error('Failed to initialize content manager:', error);
    }
  },

  // Returns synchronous file size by seeking to END (0 = unknown/error)
  _getFileSize(path) {
    try {
      const fh = tizen.filesystem.openFile(path, 'r');
      const size = fh.seek(0, 'END');
      fh.close();
      return size;
    } catch (e) {
      return 0;
    }
  },

  // Compatibility shim for legacy openStream-based read code in player.js
  _openStreamShim(path, mode, onSuccess, onError) {
    try {
      if (mode === 'r') {
        const fh = tizen.filesystem.openFile(path, 'r');
        const size = fh.seek(0, 'END');
        fh.seek(0, 'BEGIN');
        const data = fh.readData();
        fh.close();
        // Build a minimal FileStream-like shim
        const stream = {
          bytesAvailable: size,
          readBytes: (n) => Array.prototype.slice.call(data.subarray(0, n)),
          close: () => {}
        };
        onSuccess(stream);
      } else if (mode === 'w') {
        // Write shim — writeBytes called later; buffer accumulated
        const chunks = [];
        const stream = {
          writeBytes: (bytes) => chunks.push(bytes),
          write: (str) => chunks.push(str),
          close: () => {
            try {
              const fh = tizen.filesystem.openFile(path, 'rwo');
              if (chunks.length) {
                const all = [].concat.apply([], chunks);
                if (typeof all[0] === 'number') {
                  fh.writeData(new Uint8Array(all));
                } else {
                  fh.writeString(chunks.join(''));
                }
              }
              fh.close();
            } catch (err) {
              logger.error('_openStreamShim write close error:', err.message || err);
            }
          }
        };
        onSuccess(stream);
      } else {
        if (onError) onError(new Error('Unsupported mode: ' + mode));
      }
    } catch (err) {
      if (onError) onError(err); else logger.error('_openStreamShim error:', err.message || err);
    }
  },

  // Ensure storage path exists (Tizen 5.0+ path-based API)
  ensureStoragePath() {
    return new Promise((resolve, reject) => {
      try {
        const path = 'wgt-private/content';
        if (tizen.filesystem.pathExists(path)) {
          this.storagePath = path;
          logger.info('Storage directory ready:', path);
          resolve(path);
        } else {
          logger.info('Creating content directory...');
          tizen.filesystem.createDirectory(
            path,
            true,
            () => {
              this.storagePath = path;
              logger.info('Content directory created:', path);
              resolve(path);
            },
            (error) => reject(error)
          );
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  async ensureHtmlPackagesPath() {
    if (this.htmlPackagesPath) {
      return this.htmlPackagesPath;
    }
    if (!this.storagePath) {
      await this.ensureStoragePath();
    }
    const path = this.storagePath + '/html-packages';
    if (!tizen.filesystem.pathExists(path)) {
      await new Promise((resolve, reject) => {
        tizen.filesystem.createDirectory(path, true, resolve, reject);
      });
    }
    this.htmlPackagesPath = path;
    return this.htmlPackagesPath;
  },

  // Backward-compat alias
  ensureHtmlPackagesDirectory() { return this.ensureHtmlPackagesPath(); },
  ensureStorageDirectory() { return this.ensureStoragePath(); },

  pathExists(path) {
    try {
      return !!path && tizen.filesystem.pathExists(path);
    } catch (error) {
      return false;
    }
  },

  toUri(path) {
    try {
      return path ? tizen.filesystem.toURI(path) : null;
    } catch (error) {
      return null;
    }
  },

  getPathFileSize(path) {
    try {
      const fh = tizen.filesystem.openFile(path, 'r');
      const size = fh.seek(0, 'END');
      fh.close();
      return typeof size === 'number' ? size : 0;
    } catch (error) {
      return 0;
    }
  },

  readPathBytes(path) {
    const fh = tizen.filesystem.openFile(path, 'r');
    try {
      return fh.readData();
    } finally {
      try { fh.close(); } catch (_) {}
    }
  },

  writePathBytes(path, bytes) {
    const fh = tizen.filesystem.openFile(path, 'rwo', true);
    try {
      fh.writeData(bytes);
    } finally {
      try { fh.close(); } catch (_) {}
    }
  },

  deletePath(path) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.pathExists(path)) {
          resolve();
          return;
        }
        tizen.filesystem.deleteFile(path, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  },

  listDirectoryNames(path) {
    return new Promise((resolve, reject) => {
      try {
        tizen.filesystem.listDirectory(path, (names) => resolve(names || []), reject);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Download with Tizen Download API using custom filename (for SyncPlay)
  downloadWithTizenAPICustomName(content, customFileName) {
    return new Promise((resolve, reject) => {
      const listener = {
        onprogress: (id, receivedSize, totalSize) => {
          const progress = Math.round((receivedSize / totalSize) * 100);
          logger.info(`Download progress (${customFileName}): ${progress}%`);
        },
        onpaused: (id) => {
          logger.warn(`Download paused: ${customFileName}`);
        },
        oncanceled: (id) => {
          logger.warn(`Download canceled: ${customFileName}`);
          reject(new Error('Download canceled'));
        },
        oncompleted: (id, fullPath) => {
          logger.info(`Download completed via Tizen API: ${customFileName}`);
          try {
            const filePath = this.storagePath + '/' + customFileName;
            resolve(tizen.filesystem.toURI(filePath));
          } catch (error) {
            logger.error('Error resolving downloaded file:', error);
            reject(error);
          }
        },
        onfailed: (id, error) => {
          logger.error(`Download failed (${customFileName}):`, error);
          // Fallback to XHR on Tizen API failure
          this.downloadContentWithName(content, customFileName)
            .then(resolve)
            .catch(reject);
        }
      };

      const destinationDir = tizen.filesystem.toURI(this.storagePath).replace('file://', '');
      const request = new tizen.DownloadRequest(
        content.url,
        destinationDir,
        customFileName,
        'CELLULAR_WIFI' // Allow download on both cellular and WiFi
      );

      try {
        const downloadId = tizen.download.start(request, listener);
        logger.info(`Started Tizen download for ${customFileName} (ID: ${downloadId})`);
      } catch (error) {
        logger.error(`Tizen download start failed for ${customFileName}:`, error);
        // Fallback to XHR
        this.downloadContentWithName(content, customFileName)
          .then(resolve)
          .catch(reject);
      }
    });
  },

  // Download content for SyncPlay with deterministic filename (all devices use same path)
  async downloadSyncContent(content, syncFileName) {
    if (!this.storagePath) {
      await this.ensureStoragePath();
    }

    const existingPath = this.storagePath + '/' + syncFileName;
    const existingExists = this.pathExists(existingPath);
    const existingSize = existingExists ? this.getPathFileSize(existingPath) : 0;

    // Check if already downloaded
    const fileSize = await this.getContentSize(content.url);
    if (fileSize && existingExists && existingSize === fileSize) {
      logger.info(`SyncPlay content unchanged (size match), skipping download: ${syncFileName}`);
      return this.toUri(existingPath);
    }

    // Download to sync-specific filename
    logger.info(`Downloading SyncPlay content as: ${syncFileName}`);
    
    // Use Tizen Download API for large files (>100MB), XHR for small files
    try {
      if (fileSize && fileSize > this.LARGE_FILE_THRESHOLD && typeof tizen !== 'undefined' && tizen.download) {
        logger.info(`Using Tizen Download API for large SyncPlay file (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
        const uri = await this.downloadWithTizenAPICustomName(content, syncFileName);
        return uri;
      } else {
        logger.info(`Using XHR for SyncPlay file (${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : 'unknown size'})`);
        const uri = await this.downloadContentWithName(content, syncFileName);
        return uri;
      }
    } catch (error) {
      logger.error('SyncPlay download failed:', error);
      return null;
    }
  },

  // Download content to local storage - uses Tizen Download API for large files, XMLHttpRequest for small
  async downloadContent(content) {
    // Fast-path: already resolved this session, no need for any I/O
    if (content && content.id) {
      const cachedUri = this.cachedUrlMap.get(String(content.id));
      if (cachedUri) {
        logger.info(`Using in-memory cached URL for ${content.name || content.id}`);
        return cachedUri;
      }
    }

    const fileName = this.getFileName(content);
    const existingPath = this.storagePath && fileName ? this.storagePath + '/' + fileName : null;
    const existingExists = existingPath ? this.pathExists(existingPath) : false;
    const existingSize = existingExists && existingPath ? this.getPathFileSize(existingPath) : 0;

    // Pre-check existing file to avoid redundant downloads when size matches
    // If file exists on disk, check if it's valid without making a HEAD request.
    // Only fall back to HEAD if the local file size is 0 or unknown.
    if (existingExists && existingSize > 0) {
      logger.info(`Content found on disk, skipping HEAD request: ${fileName}`);
      const uri = this.toUri(existingPath);
      if (content && content.id) {
        this.cachedUrlMap.set(String(content.id), uri);
      }
      return uri;
    }

    // Try to get file size from HEAD request to decide download method
    const fileSize = await this.getContentSize(content.url);

    if (fileSize && existingExists && existingSize === fileSize) {
      logger.info(`Content unchanged (size match), skipping download: ${fileName}`);
      const uri = this.toUri(existingPath);
      if (content && content.id) {
        this.cachedUrlMap.set(String(content.id), uri);
      }
      return uri;
    }

    if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
      window.Player.handleDownloadProgress(0);
    }
    
    // Use Tizen Download API for large files (better resume support, background download)
    if (fileSize && fileSize > this.LARGE_FILE_THRESHOLD && typeof tizen !== 'undefined' && tizen.download) {
      logger.info(`Large file detected (${(fileSize / 1024 / 1024).toFixed(1)}MB), using Tizen Download API`);
      return this.downloadWithTizenAPI(content);
    }
    
    // Use XMLHttpRequest for smaller files or if Tizen API unavailable
    logger.info('Using XMLHttpRequest for download');
    return this.downloadContentFallback(content);
  },

  // Get content size via HEAD request
  async getContentSize(url) {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onload = () => {
          const size = parseInt(xhr.getResponseHeader('Content-Length'), 10);
          resolve(size || null);
        };
        xhr.onerror = () => resolve(null);
        xhr.timeout = 5000; // 5s timeout for HEAD request
        xhr.ontimeout = () => resolve(null);
        xhr.send();
      } catch (error) {
        resolve(null);
      }
    });
  },

  // Download using Tizen Download API (for large files)
  async downloadWithTizenAPI(content) {
    return new Promise((resolve, reject) => {
      try {
        const fileName = this.getFileName(content);
        // Tizen DownloadRequest expects destination directory path (not file path)
        const destinationDir = this.storagePath;

        const downloadRequest = new tizen.DownloadRequest(
          content.url,
          destinationDir,
          fileName,
          'CELLULAR_WIFI' // Allow download on both cellular and WiFi
        );

        const listener = {
          onprogress: (id, receivedSize, totalSize) => {
            const percent = Math.round((receivedSize / totalSize) * 100);
            logger.debug(`Download progress: ${percent}% (${(receivedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
            if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
              window.Player.handleDownloadProgress(percent);
            }
          },

          onpaused: (id) => {
            logger.warn('Download paused:', id);
          },

          oncanceled: (id) => {
            logger.warn('Download canceled:', id);
            this.activeDownloads.delete(id);
            reject(new Error('Download canceled'));
          },

          oncompleted: (id, fullPath) => {
            logger.info('Download completed:', fullPath);
            this.activeDownloads.delete(id);
            if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
              window.Player.handleDownloadProgress(100);
            }
            
            // Convert file path to URI
            try {
              const uri = this.toUri(this.storagePath + '/' + fileName);
              if (content && content.id) {
                this.cachedUrlMap.set(String(content.id), uri);
              }
              resolve(uri);
            } catch (error) {
              logger.error('Failed to resolve downloaded file:', error);
              reject(error);
            }
          },

          onfailed: (id, error) => {
            logger.error('Download failed:', error.name, error.message);
            this.activeDownloads.delete(id);
            if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
              window.Player.handleDownloadProgress(0);
            }
            
            // Fallback to XMLHttpRequest on failure
            logger.info('Falling back to XMLHttpRequest...');
            this.downloadContentFallback(content)
              .then(resolve)
              .catch(reject);
          }
        };

        const downloadId = tizen.download.start(downloadRequest, listener);
        this.activeDownloads.set(downloadId, { content, fileName });
        logger.info(`Started download with ID: ${downloadId}`);

      } catch (error) {
        logger.error('Failed to start Tizen download:', error);
        // Fallback to XMLHttpRequest
        this.downloadContentFallback(content)
          .then(resolve)
          .catch(reject);
      }
    });
  },

  // Download with custom filename
  async downloadContentWithName(content, fileName) {
    return new Promise((resolve, reject) => {
      try {
        const localPath = this.storagePath + '/' + fileName;

        logger.info(`Downloading to custom filename: ${fileName}`);

        const xhr = new XMLHttpRequest();
        xhr.open('GET', content.url, true);
        xhr.responseType = 'blob';
        // Set longer timeout for large files (4K videos can be 500MB+)
        xhr.timeout = 300000; // 5 minutes

        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
              window.Player.handleDownloadProgress(percent);
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const blob = xhr.response;

            const reader = new FileReader();
            reader.onload = () => {
              const arrayBuffer = reader.result;
              const bytes = new Uint8Array(arrayBuffer);

              try {
                ContentManager.writePathBytes(localPath, bytes);
                logger.info(`Content downloaded successfully: ${fileName}`);
                if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
                  window.Player.handleDownloadProgress(100);
                }
                const uri = ContentManager.toUri(localPath);
                if (content && content.id) {
                  ContentManager.cachedUrlMap.set(String(content.id), uri);
                }
                resolve(uri);
              } catch (writeError) {
                logger.error('Failed to write file bytes:', writeError);
                reject(writeError);
              }
            };
            reader.onerror = (error) => {
              logger.error('Failed to read blob:', error);
              reject(error);
            };
            reader.readAsArrayBuffer(blob);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error'));
        };

        xhr.ontimeout = () => {
          logger.error(`Download timeout for ${fileName} (5 min limit exceeded)`);
          reject(new Error('Download timeout - file too large or network too slow'));
        };

        xhr.send();
      } catch (error) {
        reject(error);
      }
    });
  },

  // Fallback download using XMLHttpRequest
  async downloadContentFallback(content) {
    return new Promise((resolve, reject) => {
      try {
        const fileName = this.getFileName(content);
        const localPath = this.storagePath + '/' + fileName;

        logger.info(`Using XMLHttpRequest fallback: ${content.name}`);

        const xhr = new XMLHttpRequest();
        xhr.open('GET', content.url, true);
        xhr.responseType = 'blob';
        xhr.timeout = 120_000; // 2-minute hard limit — prevents silent hangs on large files

        xhr.ontimeout = () => {
          logger.error(`XHR timeout downloading: ${content.name} (${content.url})`);
          reject(new Error('XHR timeout'));
        };

        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
              window.Player.handleDownloadProgress(percent);
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const blob = xhr.response;
            if (this.pathExists(localPath) && this.getPathFileSize(localPath) === blob.size) {
              logger.info(`Content unchanged (size match), skipping overwrite: ${fileName}`);
              resolve(this.toUri(localPath));
              return;
            }

            if (this.pathExists(localPath)) {
              logger.info(`Overwriting existing file: ${fileName}`);
            }

            const reader = new FileReader();
            reader.onload = () => {
              const arrayBuffer = reader.result;
              const bytes = new Uint8Array(arrayBuffer);

              try {
                ContentManager.writePathBytes(localPath, bytes);
                logger.info(`Content downloaded successfully: ${fileName}`);
                if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
                  window.Player.handleDownloadProgress(100);
                }
                const uri = ContentManager.toUri(localPath);
                if (content && content.id) {
                  ContentManager.cachedUrlMap.set(String(content.id), uri);
                }
                resolve(uri);
              } catch (writeError) {
                logger.error('Failed to write file bytes:', writeError);
                reject(writeError);
              }
            };
            reader.onerror = (error) => {
              logger.error('Failed to read blob:', error);
              reject(error);
            };
            reader.readAsArrayBuffer(blob);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => {
          logger.error(`XHR network error downloading: ${content.name} (${content.url})`);
          reject(new Error('Network error'));
        };

        xhr.send();
      } catch (error) {
        reject(error);
      }
    });
  },

  // Check network connectivity
  isNetworkAvailable() {
    try {
      // Use Samsung Network API to check connectivity
      if (typeof webapis !== 'undefined' && webapis.network) {
        try {
          return webapis.network.isConnectedToGateway();
        } catch (e) {
          // isConnectedToGateway throws error 18 (NetworkError) on some firmwares —
          // fall back to getActiveConnectionType (0 = DISCONNECTED)
          logger.debug('isConnectedToGateway failed (code ' + ((e && e.code) || e) + '), trying getActiveConnectionType');
          try {
            const connType = webapis.network.getActiveConnectionType();
            return connType !== 0; // 0 = webapis.network.NetworkType.DISCONNECTED
          } catch (e2) {
            // Both methods unavailable (error 18 = network service not ready) — assume connected
            logger.debug('getActiveConnectionType also failed (code ' + ((e2 && e2.code) || e2) + '), assuming connected');
            return true;
          }
        }
      }
    } catch (error) {
      logger.debug('Network API unavailable, assuming connected');
    }
    return true;
  },

  // Download all content items in a playlist
  async downloadPlaylist(playlist) {
    if (!playlist || !playlist.items || playlist.items.length === 0) {
      return playlist;
    }

    // Check network before downloading
    if (!this.isNetworkAvailable()) {
      logger.error('No network connection, cannot download playlist');
      return playlist; // Return playlist with remote URLs
    }

    // Fast-path: if every downloadable item is already in the in-memory cache
    // (populated during this session), skip all network HEAD requests and return
    // the playlist with cached URLs immediately.  This prevents re-downloading
    // on republish when the content files haven't actually changed.
    const downloadableTypes = new Set(['VIDEO', 'IMAGE', 'PDF', 'DOCUMENT', 'PRESENTATION']);
    const allInMemCache = playlist.items.every(item => {
      const c = item && item.content;
      if (!c || !c.url) return true;
      if (!downloadableTypes.has(String(c.type || '').toUpperCase())) return true;
      const cid = c.id ? String(c.id) : null;
      return cid && this.cachedUrlMap.has(cid);
    });
    if (allInMemCache) {
      logger.info('All playlist items already in session cache, skipping download');
      return {
        ...playlist,
        items: playlist.items.map(item => {
          const c = item && item.content;
          const cid = c && c.id ? String(c.id) : null;
          const cachedUrl = cid ? this.cachedUrlMap.get(cid) : null;
          if (cachedUrl) {
            return { ...item, content: { ...c, url: cachedUrl, originalUrl: c.url } };
          }
          return item;
        }),
      };
    }

    logger.info(`Downloading playlist: ${playlist.playlistName} (${playlist.items.length} items)`);

    const downloadedItems = [];

    for (const item of playlist.items) {
      try {
        const content = item.content;
        
        // Skip if no URL
        if (!content.url) {
          logger.warn(`Content ${content.name} has no URL, skipping download`);
          downloadedItems.push(item);
          continue;
        }
        
        // Handle HTML5 packages (download and unzip for offline playback)
        if (content.type === 'HTML') {
          try {
            const localHtml = await this.prepareHtmlPackage(content);
            if (localHtml && localHtml.url) {
              downloadedItems.push({
                ...item,
                content: {
                  ...content,
                  url: localHtml.url,
                  originalUrl: content.url,
                  metadata: localHtml.metadata || content.metadata,
                }
              });
              continue;
            }
          } catch (htmlError) {
            logger.warn('Failed to prepare HTML package, falling back to remote URL:', (htmlError && htmlError.message) || htmlError);
          }
        }

        // Skip remote HTML/WEBPAGE content (stream directly)
        if (content.type === 'HTML' || content.type === 'WEBPAGE') {
          logger.info(`Skipping download for ${content.type}: ${content.name}`);
          downloadedItems.push(item);
          continue;
        }

        // IPTV streams are live; do not download/cache, just keep remote URL
        if (content.type === 'IPTV') {
          logger.info('Skipping download for IPTV stream:', content.name);
          downloadedItems.push(item);
          continue;
        }

        // Zone layout is config-only (zones stored in metadata); no file to download
        if (content.type === 'ZONE_LAYOUT') {
          logger.info('Skipping download for ZONE_LAYOUT (config-only):', content.name);
          downloadedItems.push(item);
          continue;
        }

        // Download video/image content with retry logic
        let localUrl = null;
        let retries = 3;
        
        while (retries > 0 && !localUrl) {
          try {
            localUrl = await this.downloadContent(content);
            break;
          } catch (error) {
            retries--;
            logger.warn(`Download failed, ${retries} retries left:`, error.message);
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
            }
          }
        }
        
        if (localUrl) {
          downloadedItems.push({
            ...item,
            content: {
              ...content,
              url: localUrl, // Use local file URL
              originalUrl: content.url // Keep original for reference
            }
          });
        } else {
          logger.error(`Failed to download after retries: ${content.name}, using remote URL`);
          // Keep original item with remote URL as fallback
          downloadedItems.push(item);
        }
      } catch (error) {
        logger.error(`Failed to process content: ${item.content.name}`, error);
        // Keep original item with remote URL as fallback
        downloadedItems.push(item);
      }
    }

    return {
      ...playlist,
      items: downloadedItems
    };
  },

  // Generate local filename from content
  getFileName(content) {
    // Handle null/undefined URL
    if (!content.url) {
      logger.warn('Content has no URL:', content);
      return null;
    }

    const contentId = content.id;

    // Known content-type → canonical extension mapping.
    // Use this as the primary source so that even when the download URL has no
    // extension (or has a signed-URL hash as the path suffix) the cached file
    // always has a proper extension that Samsung's b2bdoc / AVPlay APIs need.
    const TYPE_EXT = {
      PDF: 'pdf',
      DOCUMENT: 'pdf',
      PRESENTATION: 'pptx',
      VIDEO: null,   // must be derived from URL (mp4/webm/etc differ)
      IMAGE: null,   // must be derived from URL (jpg/png/etc differ)
    };
    if (content.type && TYPE_EXT[content.type] !== undefined && TYPE_EXT[content.type] !== null) {
      return `${contentId}.${TYPE_EXT[content.type]}`;
    }

    // For types not in the map, derive extension from the URL path.
    // Strip query string and fragment FIRST so dots in signed-URL tokens
    // are not mistaken for the file extension.
    let pathOnly = content.url;
    const qIdx = pathOnly.indexOf('?');
    if (qIdx !== -1) pathOnly = pathOnly.substring(0, qIdx);
    const hIdx = pathOnly.indexOf('#');
    if (hIdx !== -1) pathOnly = pathOnly.substring(0, hIdx);

    const lastSlash = pathOnly.lastIndexOf('/');
    const baseName = lastSlash !== -1 ? pathOnly.substring(lastSlash + 1) : pathOnly;
    const dotIdx = baseName.lastIndexOf('.');
    const extension = dotIdx !== -1 ? baseName.substring(dotIdx + 1).toLowerCase() : null;

    // Sanity-check: a real file extension is short and alphanumeric.
    // If it looks like a hash/token, ignore it and try metadata fields instead.
    if (!extension || extension.length > 8 || !/^[a-zA-Z0-9]+$/.test(extension)) {
      // Try the original uploaded filename first (most reliable source)
      if (content.originalName) {
        const origDot = content.originalName.lastIndexOf('.');
        if (origDot !== -1) {
          const origExt = content.originalName.substring(origDot + 1).toLowerCase();
          if (origExt.length <= 8 && /^[a-zA-Z0-9]+$/.test(origExt)) {
            return `${contentId}.${origExt}`;
          }
        }
      }
      // Fall back to MIME type mapping
      if (content.mimeType) {
        const MIME_TO_EXT = {
          'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
          'video/x-matroska': 'mkv', 'video/avi': 'avi', 'video/x-msvideo': 'avi',
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
          'image/webp': 'webp', 'image/bmp': 'bmp',
          'application/pdf': 'pdf',
        };
        const mimeExt = MIME_TO_EXT[content.mimeType.toLowerCase()];
        if (mimeExt) return `${contentId}.${mimeExt}`;
      }
      logger.warn('Could not extract valid file extension from URL, storing without extension:', content.url);
      return `${contentId}`;
    }

    return `${contentId}.${extension}`;
  },

  // Return cached local file URI if present, else null
  async getCachedUrl(content) {
    try {
      if (!content) return null;

      // If caller already has a file:// URL, keep it.
      if (typeof content.url === 'string' && content.url.startsWith('file://')) {
        return content.url;
      }

      const contentId = content.id ? String(content.id) : null;
      if (contentId && this.cachedUrlMap.has(contentId)) {
        return this.cachedUrlMap.get(contentId);
      }

      if (!this.storagePath) {
        await this.ensureStoragePath();
      }

      // First try: resolve expected filename from URL extension
      const fileName = this.getFileName(content);
      if (fileName) {
        try {
          const filePath = this.storagePath + '/' + fileName;
          if (this.pathExists(filePath)) {
            const uri = this.toUri(filePath);
            if (contentId) this.cachedUrlMap.set(contentId, uri);
            return uri;
          }
        } catch (e) {
          // ignored
        }
      }

      // Fallback: scan directory for contentId.* (handles URLs without extensions)
      if (contentId) {
        try {
          const files = await this.listDirectoryNames(this.storagePath);
          const match = files.find((name) => typeof name === 'string' && name.indexOf(contentId + '.') === 0);
          if (match) {
            const uri = this.toUri(this.storagePath + '/' + match);
            this.cachedUrlMap.set(contentId, uri);
            return uri;
          }
        } catch (e) {
          // ignored
        }
      }

      return null;
    } catch (error) {
      logger.error('Error getting cached URL:', error);
      return null;
    }
  },

  // Clear cached content
  async clearCache() {
    try {
      if (this.storagePath) {
        const files = await this.listDirectoryNames(this.storagePath);
        for (const name of files) {
          try {
            await this.deletePath(this.storagePath + '/' + name);
            logger.info(`Deleted cached file: ${name}`);
          } catch (error) {
            logger.warn(`Failed to delete file: ${name}`, error);
          }
        }
        logger.info('Cache cleared');
      }
    } catch (error) {
      logger.error('Failed to clear cache:', error);
    }
  },

  // Get cache size
  async getCacheSize() {
    try {
      if (this.storagePath) {
        let totalSize = 0;
        const files = await this.listDirectoryNames(this.storagePath);
        files.forEach((name) => {
          totalSize += this.getPathFileSize(this.storagePath + '/' + name);
        });
        return totalSize;
      }
      return 0;
    } catch (error) {
      logger.error('Failed to get cache size:', error);
      return 0;
    }
  },

  async prepareHtmlPackage(content) {
    const packageInfo = this.getHtmlPackageInfo(content);
    if (!packageInfo) {
      return null;
    }

    if (!packageInfo.zipUrl) {
      logger.warn('HTML package is missing ZIP URL, cannot cache locally:', content.name);
      return null;
    }

    const packagesDir = await this.ensureHtmlPackagesPath();
    const folderName = `html-${packageInfo.packageKey}-${packageInfo.signature}`;
    const packageDir = packagesDir + '/' + folderName;

    if (!this.pathExists(packageDir)) {
      await new Promise((resolve, reject) => {
        tizen.filesystem.createDirectory(packageDir, true, resolve, reject);
      });
    }

    const hasStartPage = this.fileExistsInDirectory(packageDir, packageInfo.startPage);
    if (!hasStartPage) {
      logger.info(`Downloading HTML5 package ZIP for ${content.name}`);
      await this.populateHtmlPackage(packageDir, packageInfo, packagesDir, folderName);
    } else {
      logger.info(`Using cached HTML5 package for ${content.name}`);
    }

    const localUrl = this.buildFileUri(packageDir, packageInfo.startPage);
    if (!localUrl) {
      throw new Error('Start page not found after extracting HTML package');
    }

    return {
      url: localUrl,
      metadata: this.mergeMetadata(content.metadata, {
        localPackagePath: packageDir,
        localPackageStart: packageInfo.startPage,
        packageSignature: packageInfo.signature,
        packageSource: packageInfo.zipUrl,
        cachedAt: new Date().toISOString(),
      }),
    };
  },

  getHtmlPackageInfo(content) {
    if (!content || content.type !== 'HTML') {
      return null;
    }

    const metadata = this.parseMetadata(content.metadata);
    if (!metadata) {
      return null;
    }

    const filePath = typeof metadata.filePath === 'string' ? metadata.filePath : null;
    const packagePath = typeof metadata.packagePath === 'string' ? metadata.packagePath : null;
    const hasZip = filePath && /\.zip$/i.test(filePath);
    const isPackage = Boolean(metadata.isPackage || packagePath || hasZip);

    if (!isPackage) {
      return null;
    }

    const startPage = (metadata.startPage || 'index.html').replace(/^\/+/, '');
    const packageKey = this.sanitizeId(content.id || content.contentId || content.slug || content.name || 'html');
    const signatureSource = [
      content.id || content.contentId || '',
      content.updatedAt || content.updated_at || '',
      content.version || '',
      filePath || '',
      packagePath || '',
      metadata.packageUrl || '',
      startPage,
    ].join('|');

    return {
      metadata,
      startPage,
      packageKey,
      signature: this.hashString(signatureSource),
      zipUrl: this.buildPublicUrl(metadata.packageZipUrl || filePath),
      packageUrl: metadata.packageUrl || (packagePath ? this.buildPublicUrl(`${packagePath}/${startPage}`) : null),
    };
  },

  parseMetadata(metadata) {
    if (!metadata) {
      return null;
    }

    if (typeof metadata === 'object') {
      return metadata;
    }

    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch (error) {
        logger.warn('Failed to parse metadata JSON:', error.message || error);
      }
    }

    return null;
  },

  mergeMetadata(existing, patch) {
    let base = this.parseMetadata(existing);
    if (!base || typeof base !== 'object') {
      base = {};
    }
    return { ...base, ...patch };
  },

  getBackendBaseUrl() {
    if (this.backendBaseUrl) {
      return this.backendBaseUrl;
    }
    const base = (CONFIG.API_BASE || '').replace(/\/api\/?.*$/i, '').replace(/\/+$/, '');
    this.backendBaseUrl = base || CONFIG.API_BASE;
    return this.backendBaseUrl;
  },

  buildPublicUrl(path) {
    if (!path) {
      return null;
    }
    if (/^https?:\/\//i.test(path)) {
      // Rewrite localhost/127.0.0.1 URLs to use the configured backend.
      // This handles content records that were created when BASE_URL was localhost.
      const base = this.getBackendBaseUrl();
      if (base && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(path)) {
        try {
          const serverOrigin = new URL(base).origin;
          return path.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, serverOrigin);
        } catch (e) {
          // fall through — return path as-is
        }
      }
      return path;
    }
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) {
      return null;
    }
    return `${this.getBackendBaseUrl()}/${normalized}`;
  },

  sanitizeId(value) {
    return (value || 'pkg').toString().replace(/[^a-z0-9-_]/gi, '').toLowerCase() || 'pkg';
  },

  hashString(value) {
    if (!value) {
      return '0';
    }
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  },

  fileExistsInDirectory(dir, relativePath) {
    if (!dir || !relativePath) {
      return false;
    }
    const cleanPath = relativePath.replace(/^\/+/, '');
    return this.pathExists(`${dir}/${cleanPath}`);
  },

  buildFileUri(dir, relativePath) {
    if (!dir || !relativePath) {
      return null;
    }
    const cleanPath = relativePath.replace(/^\/+/, '');
    return this.toUri(`${dir}/${cleanPath}`);
  },

  async populateHtmlPackage(targetDir, packageInfo, packagesDir, folderName) {
    const zipFileName = `${folderName}.zip`;
    const zipFile = await this.downloadZipToDirectory(packageInfo.zipUrl, packagesDir, zipFileName);
    try {
      await this.extractZipFile(zipFile, targetDir);
    } finally {
      this.safeDeleteFile(packagesDir, zipFile);
    }
  },

  async downloadZipToDirectory(url, directory, fileName) {
    if (!url) {
      throw new Error('Missing ZIP URL');
    }
    const data = await this.fetchArrayBuffer(url);
    const filePath = `${directory}/${fileName}`;
    if (this.pathExists(filePath)) {
      await this.deletePath(filePath);
    }
    await this.writeBytesToFile(filePath, new Uint8Array(data));
    return filePath;
  },

  fetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error while downloading HTML package'));
        xhr.send();
      } catch (error) {
        reject(error);
      }
    });
  },

  writeBytesToFile(filePath, bytes) {
    return new Promise((resolve, reject) => {
      try {
        this.writePathBytes(filePath, bytes);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  },

  extractZipFile(zipFile, targetDir) {
    return new Promise((resolve, reject) => {
      try {
        const zipUri = this.toUri(zipFile);
        const destination = this.toUri(targetDir);
        if (!zipUri || !destination) {
          reject(new Error('Invalid ZIP or destination path for extraction'));
          return;
        }

        tizen.archive.open(
          zipUri,
          'r',
          (archive) => {
            archive.extractAll(
              destination,
              () => {
                try { archive.close(); } catch (_) {}
                resolve();
              },
              (error) => {
                try { archive.close(); } catch (_) {}
                reject(error);
              }
            );
          },
          (error) => reject(error)
        );
      } catch (error) {
        reject(error);
      }
    });
  },

  safeDeleteFile(directory, file) {
    if (!directory || !file) {
      return;
    }
    try {
      const filePath = typeof file === 'string' ? file : `${directory}/${file.name || file.fullPath}`;
      tizen.filesystem.deleteFile(filePath);
    } catch (error) {
      logger.warn('Failed to delete temporary file:', file.name || file.fullPath || file, error.message || error);
    }
  },

  // Write binary content using the most reliable API available on the device
  writeBinaryFile(fs, uint8Array) {
    if (typeof fs.writeBytes === 'function') {
      this.writeBytesChunked(fs, uint8Array);
      return;
    }

    if (typeof fs.writeBase64 === 'function') {
      fs.writeBase64(this.uint8ToBase64(uint8Array));
      return;
    }

    // Final fallback: write as binary string
    fs.write(this.uint8ToBinaryString(uint8Array));
  },

  writeBytesChunked(fs, uint8Array) {
    const chunkSize = 256 * 1024; // 256KB chunks keep memory bounded on low-RAM devices
    for (let offset = 0; offset < uint8Array.length; offset += chunkSize) {
      const chunk = uint8Array.subarray(offset, Math.min(offset + chunkSize, uint8Array.length));
      const chunkArray = Array.prototype.slice.call(chunk);
      fs.writeBytes(chunkArray);
    }
  },

  uint8ToBase64(uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  },

  uint8ToBinaryString(uint8Array) {
    let result = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      result += String.fromCharCode.apply(null, chunk);
    }
    return result;
  }
};
