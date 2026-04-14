// Platform detection — must be the first <script> in index.html
// All other modules reference Platform.isLegacy instead of sniffing APIs inline.

window.Platform = (function() {
  var ver = '0.0';
  try {
    ver = tizen.systeminfo.getCapability(
      'http://tizen.org/feature/platform.version'
    ) || '0.0';
  } catch (e) {}
  var major = parseInt(ver.split('.')[0], 10) || 0;
  return {
    tizenVersion : ver,     // e.g. '4.0.0', '6.5.0'
    tizenMajor   : major,
    isLegacy     : major < 5,   // Tizen ≤4 — old filesystem API + b2bapis era
    isModern     : major >= 5,  // Tizen 5+ — new FileSystemManager path API
  };
})();
