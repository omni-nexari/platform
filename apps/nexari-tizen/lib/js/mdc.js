// Shim required by the Samsung-signed stubs in lib/ (server2018/2019/2022.js.signed).
// Those stubs call require('./js/mdc.js')() — which resolves to this file.
// We simply re-export the real MDC bridge so it stays a single source of truth.
// Update ../../js/mdc.js freely; no re-signing required.
module.exports = require('../../js/mdc.js');
