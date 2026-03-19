/** Samsung hardware identity — reads DUID and device info from Tizen WebAPI. */

export interface DeviceIdentity {
  duid: string;
  modelName: string;
  modelCode: string;
  serialNumber: string;
  firmwareVersion: string;
}

export function getIdentity(): DeviceIdentity {
  if (typeof webapis === 'undefined') {
    // Dev fallback
    return {
      duid: 'DEV-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      modelName: 'DevDisplay',
      modelCode: 'DEV0000',
      serialNumber: 'SN-DEV',
      firmwareVersion: '0.0.0',
    };
  }
  return {
    duid: webapis.productinfo.getDuid(),
    modelName: webapis.productinfo.getModel(),
    modelCode: webapis.productinfo.getModelCode(),
    serialNumber: webapis.systemcontrol.getSerialNumber(),
    firmwareVersion: webapis.productinfo.getFirmware(),
  };
}
