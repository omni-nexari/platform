/** Network telemetry */

export interface NetworkInfo {
  mac: string;
  ip: string;
  gateway: string;
  dns: string;
  connectionType: 'wifi' | 'ethernet';
  wifiSsid: string;
  wifiStrength: number;
}

export function getNetworkInfo(): NetworkInfo {
  if (typeof webapis === 'undefined') {
    return { mac: 'AA:BB:CC:DD:EE:FF', ip: '127.0.0.1', gateway: '192.168.1.1', dns: '8.8.8.8', connectionType: 'ethernet', wifiSsid: '', wifiStrength: 0 };
  }
  const connType = webapis.network.getActiveConnectionType();
  return {
    mac: webapis.network.getMac(),
    ip: webapis.network.getIp(),
    gateway: webapis.network.getGateway(),
    dns: webapis.network.getDns(),
    connectionType: connType === 'WIFI' ? 'wifi' : 'ethernet',
    wifiSsid: connType === 'WIFI' ? webapis.network.getWiFiSsid() : '',
    wifiStrength: connType === 'WIFI' ? webapis.network.getWiFiSignalStrengthLevel() : 0,
  };
}
