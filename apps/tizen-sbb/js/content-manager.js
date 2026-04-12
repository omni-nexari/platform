// Content Manager - Downloads and caches content to local storage

window.ContentManager = {
  downloadQueue: [],
  downloading: false,
  storageDir: null,
  htmlPackagesDir: null,
  backendBaseUrl: null,
  activeDownloads: new Map(), // Track Tizen download IDs
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024, // 50MB - use Tizen Download API for files larger than this
  cachedUrlMap: new Map(), // Map<contentId, fileUri>

  // Initialize content manager
  async init() {
    try {
      // Get the wgt-private storage directory
      await this.ensureStorageDirectory();
      await this.ensureHtmlPackagesDirectory();
      logger.info('Content manager initialized');
    } catch (error) {
      logger.error('Failed to initialize content manager:', error);
    }
  },

  // Ensure storage directory exists
  ensureStorageDirectory() {
    return new Promise((resolve, reject) => {
      try {
        tizen.filesystem.resolve(
          'wgt-private/content',
          (dir) => {
            this.storageDir = dir;
            logger.info('Storage directory ready:', dir.fullPath);
            resolve(dir);
          },
          (error) => {
            // Directory doesn't exist, create it
            logger.info('Creating content directory...');
            tizen.filesystem.resolve(
              'wgt-private',
              (privateDir) => {
                privateDir.createDirectory('content');
                tizen.filesystem.resolve(
                  'wgt-private/content',
                  (contentDir) => {
                    this.storageDir = contentDir;
                    logger.info('Content directory created:', contentDir.fullPath);
                    resolve(contentDir);
                  },
                  reject
                );
              },
              reject
            );
          },
          'rw'
        );
      } catch (error) {
        reject(error);
      }
    });
  },

  async ensureHtmlPackagesDirectory() {
    if (this.htmlPackagesDir) {
      return this.htmlPackagesDir;
    }

    if (!this.storageDir) {
      await this.ensureStorageDirectory();
    }

    try {
      this.htmlPackagesDir = this.storageDir.resolve('html-packages');
    } catch (error) {
      try {
        this.htmlPackagesDir = this.storageDir.createDirectory('html-packages');
      } catch (createError) {
        logger.error('Failed to create html-packages directory:', createError);
        throw createError;
      }
    }

    return this.htmlPackagesDir;
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
            const file = this.storageDir.resolve(customFileName);
            resolve(file.toURI());
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

      const destinationDir = this.storageDir.toURI().replace('file://', '');
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
    if (!this.storageDir) {
      await this.ensureStorageDirectory();
    }

    let existingFile = null;
    try {
      existingFile = this.storageDir.resolve(syncFileName);
    } catch (e) {
      existingFile = null;
    }

    // Check if already downloaded
    const fileSize = await this.getContentSize(content.url);
    if (fileSize && existingFile && typeof existingFile.fileSize === 'number' && existingFile.fileSize === fileSize) {
      logger.info(`SyncPlay content unchanged (size match), skipping download: ${syncFileName}`);
      return existingFile.toURI();
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
    const fileName = this.getFileName(content);
    let existingFile = null;

    // Pre-check existing file to avoid redundant downloads when size matches
    if (this.storageDir && fileName) {
      try {
        existingFile = this.storageDir.resolve(fileName);
      } catch (resolveError) {
        existingFile = null;
      }
    }

    // Try to get file size from HEAD request to decide download method
    const fileSize = await this.getContentSize(content.url);

    if (fileSize && existingFile && typeof existingFile.fileSize === 'number' && existingFile.fileSize === fileSize) {
      logger.info(`Content unchanged (size match), skipping download: ${fileName}`);
      const uri = existingFile.toURI();
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
        const destinationDir = this.storageDir.fullPath;

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
              const file = this.storageDir.resolve(fileName);
              const uri = file.toURI();
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
        const localPath = this.storageDir.fullPath + '/' + fileName;

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
            
            let file = null;
            try {
              file = this.storageDir.resolve(fileName);
            } catch (resolveError) {
              // No cached version yet
              logger.debug(`No existing file for ${fileName}, creating new one`);
            }

            if (!file) {
              file = this.storageDir.createFile(fileName);
            }
            
            if (file) {
              file.openStream(
                'w',
                (fs) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const arrayBuffer = reader.result;
                    const bytes = new Uint8Array(arrayBuffer);

                    try {
                      ContentManager.writeBinaryFile(fs, bytes);
                      logger.info(`Content downloaded successfully: ${fileName}`);
                      if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
                        window.Player.handleDownloadProgress(100);
                      }
                      const uri = file.toURI();
                      if (content && content.id) {
                        ContentManager.cachedUrlMap.set(String(content.id), uri);
                      }
                      resolve(uri);
                    } catch (writeError) {
                      logger.error('Failed to write file bytes:', writeError);
                      reject(writeError);
                    } finally {
                      fs.close();
                    }
                  };
                  reader.onerror = (error) => {
                    logger.error('Failed to read blob:', error);
                    reject(error);
                  };
                  reader.readAsArrayBuffer(blob);
                },
                (error) => {
                  logger.error('Failed to open file stream:', error);
                  reject(error);
                }
              );
            } else {
              reject(new Error('Failed to create file'));
            }
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
        const localPath = this.storageDir.fullPath + '/' + fileName;

        logger.info(`Using XMLHttpRequest fallback: ${content.name}`);

        const xhr = new XMLHttpRequest();
        xhr.open('GET', content.url, true);
        xhr.responseType = 'blob';

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
            
            // Reuse existing file if present, otherwise create a new one
            let file = null;
            try {
              file = this.storageDir.resolve(fileName);
              if (file) {
                // If size matches existing file, skip overwrite
                if (typeof file.fileSize === 'number' && file.fileSize === blob.size) {
                  logger.info(`Content unchanged (size match), skipping overwrite: ${fileName}`);
                  resolve(file.toURI());
                  return;
                }
                logger.info(`Overwriting existing file: ${fileName}`);
              }
            } catch (resolveError) {
              // No cached version yet
              logger.debug(`No existing file for ${fileName}, creating new one`);
            }

            if (!file) {
              file = this.storageDir.createFile(fileName);
            }
            
            if (file) {
              file.openStream(
                'w',
                (fs) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const arrayBuffer = reader.result;
                    const bytes = new Uint8Array(arrayBuffer);

                    try {
                      ContentManager.writeBinaryFile(fs, bytes);
                      logger.info(`Content downloaded successfully: ${fileName}`);
                      if (window.Player && typeof window.Player.handleDownloadProgress === 'function') {
                        window.Player.handleDownloadProgress(100);
                      }
                      const uri = file.toURI();
                      if (content && content.id) {
                        ContentManager.cachedUrlMap.set(String(content.id), uri);
                      }
                      resolve(uri);
                    } catch (writeError) {
                      logger.error('Failed to write file bytes:', writeError);
                      reject(writeError);
                    } finally {
                      fs.close();
                    }
                  };
                  reader.onerror = (error) => {
                    logger.error('Failed to read blob:', error);
                    reject(error);
                  };
                  reader.readAsArrayBuffer(blob);
                },
                (error) => {
                  logger.error('Failed to open file stream:', error);
                  reject(error);
                }
              );
            } else {
              reject(new Error('Failed to create file'));
            }
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => {
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
        return webapis.network.isConnectedToGateway();
      }
    } catch (error) {
      logger.warn('Network API not available, assuming connected');
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
              downloadedItems.push(Object.assign({}, item, {
                content: Object.assign({}, content, {
                  url: localHtml.url,
                  originalUrl: content.url,
                  metadata: localHtml.metadata || content.metadata,
                })
              }));
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

        // Config-only content stores its runtime data in metadata; there is no file to download
        if (content.type === 'ZONE_LAYOUT' || content.type === 'MENU_BOARD') {
          logger.info(`Skipping download for ${content.type} (config-only):`, content.name);
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
          downloadedItems.push(Object.assign({}, item, {
            content: Object.assign({}, content, {
              url: localUrl, // Use local file URL
              originalUrl: content.url // Keep original for reference
            })
          }));
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

    return Object.assign({}, playlist, {
      items: downloadedItems
    });
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
    // If it looks like a hash/token, ignore it and fall through to other sources.
    if (!extension || extension.length > 8 || !/^[a-zA-Z0-9]+$/.test(extension)) {
      // Try to derive extension from originalName (e.g. "montreal.jpg")
      if (content.originalName) {
        const origDot = content.originalName.lastIndexOf('.');
        if (origDot !== -1) {
          const origExt = content.originalName.substring(origDot + 1).toLowerCase();
          if (origExt && origExt.length <= 8 && /^[a-zA-Z0-9]+$/.test(origExt)) {
            return `${contentId}.${origExt}`;
          }
        }
      }
      // Try to derive extension from mimeType (e.g. "image/jpeg" → "jpg")
      const MIME_EXT = {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
        'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
        'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv',
      };
      const mimeExt = content.mimeType && MIME_EXT[content.mimeType.toLowerCase().split(';')[0].trim()];
      if (mimeExt) return `${contentId}.${mimeExt}`;

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

      if (!this.storageDir) {
        await this.ensureStorageDirectory();
      }

      // First try: resolve expected filename from URL extension
      const fileName = this.getFileName(content);
      if (fileName) {
        try {
          const file = this.storageDir.resolve(fileName);
          if (file) {
            const uri = file.toURI();
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
          const files = this.storageDir.listFiles();
          const match = files.find((f) => typeof (f && f.name) === 'string' && f.name.indexOf(contentId + '.') === 0);
          if (match) {
            const uri = match.toURI();
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
  clearCache() {
    try {
      if (this.storageDir) {
        const files = this.storageDir.listFiles();
        files.forEach(file => {
          try {
            this.storageDir.deleteFile(file.fullPath);
            logger.info(`Deleted cached file: ${file.name}`);
          } catch (error) {
            logger.warn(`Failed to delete file: ${file.name}`, error);
          }
        });
        logger.info('Cache cleared');
      }
    } catch (error) {
      logger.error('Failed to clear cache:', error);
    }
  },

  // Get cache size
  getCacheSize() {
    try {
      if (this.storageDir) {
        let totalSize = 0;
        const files = this.storageDir.listFiles();
        files.forEach(file => {
          totalSize += file.fileSize;
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

    const packagesDir = await this.ensureHtmlPackagesDirectory();
    const folderName = `html-${packageInfo.packageKey}-${packageInfo.signature}`;
    let packageDir;

    try {
      packageDir = packagesDir.resolve(folderName);
    } catch (error) {
      packageDir = packagesDir.createDirectory(folderName);
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
        localPackagePath: packageDir.fullPath,
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
    return Object.assign({}, base, patch);
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
    try {
      dir.resolve(cleanPath);
      return true;
    } catch (error) {
      return false;
    }
  },

  buildFileUri(dir, relativePath) {
    if (!dir || !relativePath) {
      return null;
    }
    const cleanPath = relativePath.replace(/^\/+/, '');
    try {
      const file = dir.resolve(cleanPath);
      if (file && typeof file.toURI === 'function') {
        return file.toURI();
      }
    } catch (error) {
      // ignore and fall back to directory URI concatenation
    }
    if (typeof dir.toURI === 'function') {
      return `${dir.toURI()}${cleanPath}`;
    }
    return null;
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
    let fileInstance;
    try {
      fileInstance = directory.resolve(fileName);
      if (fileInstance) {
        directory.deleteFile(fileInstance.fullPath);
      }
    } catch (error) {
      // Ignore - file doesn't exist yet
    }
    fileInstance = directory.createFile(fileName);
    await this.writeBytesToFile(fileInstance, new Uint8Array(data));
    return fileInstance;
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

  writeBytesToFile(file, bytes) {
    return new Promise((resolve, reject) => {
      file.openStream(
        'w',
        (fs) => {
          try {
            this.writeBinaryFile(fs, bytes);
            fs.close();
            resolve();
          } catch (error) {
            try { fs.close(); } catch (_) {}
            reject(error);
          }
        },
        (error) => reject(error)
      );
    });
  },

  extractZipFile(zipFile, targetDir) {
    return new Promise((resolve, reject) => {
      try {
        const zipUri = typeof zipFile.toURI === 'function' ? zipFile.toURI() : null;
        const destination = typeof targetDir.toURI === 'function' ? targetDir.toURI() : null;
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
      directory.deleteFile(file.fullPath || file.name);
    } catch (error) {
      logger.warn('Failed to delete temporary file:', file.name || file.fullPath, error.message || error);
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
