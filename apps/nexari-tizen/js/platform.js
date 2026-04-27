// Platform detection — must be the first <script> in index.html
// All other modules reference Platform.isLegacy instead of sniffing APIs inline.

window.Platform = (function() {
  var ver = '0.0';
  try {
    ver = tizen.systeminfo.getCapability(
      'http://tizen.org/feature/platform.version'
    ) || '0.0';
  } catch (e) {}
  var parts = ver.split('.');
  var major = parseInt(parts[0], 10) || 0;
  var minor = parseInt(parts[1], 10) || 0;
  // webapis.document API (native PDF/PPT) requires Tizen 6.5+
  var supportsDocumentApi = major > 6 || (major === 6 && minor >= 5);
  return {
    tizenVersion       : ver,     // e.g. '4.0.0', '6.5.0'
    tizenMajor         : major,
    tizenMinor         : minor,
    isLegacy           : major < 5,   // Tizen ≤4 — old filesystem API + b2bapis era; B2BDoc for documents
    isModern           : major >= 5,  // Tizen 5+ — new FileSystemManager path API
    supportsDocumentApi: supportsDocumentApi, // Tizen 6.5+ — webapis.document available
  };
})();
