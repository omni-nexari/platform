import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bluetooth, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  ActionButton,
  Callout,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';

interface BleBeacon {
  uuid: string;
  name?: string;
  rssi: number;
  major?: number;
  minor?: number;
}

// Rough RSSI → estimated distance in cm (free-space path loss, N=2, TxPower=-65)
function rssiToEstimatedCm(rssi: number): number {
  const txPower = -65;
  const n = 2;
  return Math.round(100 * Math.pow(10, (txPower - rssi) / (10 * n)));
}

export default function BleProximityTab({
  deviceId,
  isOnline,
}: {
  deviceId: string;
  isOnline: boolean;
}) {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data: latestScan } = useQuery<{ beacons: BleBeacon[]; scannedAt: string } | null>({
    queryKey: ['ble-scan', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/ble-scan/latest`),
    staleTime: Infinity, // SSE handles live updates; REST is only for initial load
  });

  // Real-time BLE scan updates via SSE
  useEffect(() => {
    const es = new EventSource(`/api/devices/${deviceId}/ble-scan/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { beacons: BleBeacon[]; scannedAt: string };
        qc.setQueryData(['ble-scan', deviceId], data);
        setScanning(false);
      } catch { /* ignore malformed events */ }
    };
    return () => es.close();
  }, [deviceId, qc]);

  const triggerScan = useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/ble-scan`, {}),
    onSuccess: () => {
      setScanning(true);
      toast.info('BLE scan started — results will appear automatically');
    },
    onError: () => toast.error('Failed to start BLE scan'),
  });

  const beacons = latestScan?.beacons ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bluetooth className="w-5 h-5 text-[var(--blue)]" />
          <span className="font-semibold text-[var(--text)]">BLE Proximity</span>
        </div>
        <ActionButton
          onClick={() => triggerScan.mutate()}
          disabled={!isOnline || triggerScan.isPending || scanning}
          tone="default"
          className="px-3 py-1.5 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning…' : 'Scan now'}
        </ActionButton>
      </div>

      {!isOnline && (
        <Callout tone="warning">Device is offline — BLE scan requires an active connection.</Callout>
      )}

      {/* Nearby beacons */}
      <SectionCard>
        <SectionCardHeader>
          <span className="text-sm font-medium text-[var(--text)]">Nearby Beacons</span>
          {latestScan && (
            <span className="text-[10px] text-[var(--text-muted)]">
              Scanned {new Date(latestScan.scannedAt).toLocaleTimeString()}
            </span>
          )}
        </SectionCardHeader>
        <SectionCardBody>
          {beacons.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {latestScan ? 'No beacons found in last scan.' : 'No scan results yet — click Scan now.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] text-[var(--text-muted)] mb-2">
                {beacons.length} beacon{beacons.length !== 1 ? 's' : ''} detected
              </p>
              {beacons.map((b, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--text)]">{b.name || '(unnamed)'}</span>
                    <span className="ml-2 text-[var(--text-muted)] font-mono truncate">{b.uuid}</span>
                    {b.major != null && (
                      <span className="ml-1 text-[var(--text-muted)]">{b.major}/{b.minor}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-muted)] shrink-0">
                    <span>{b.rssi} dBm</span>
                    <span>~{rssiToEstimatedCm(b.rssi)} cm</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      <p className="text-[10px] text-[var(--text-muted)]">
        Rules using BLE proximity conditions are managed in{' '}
        <a href="../rule-sets" className="text-[var(--blue)] hover:underline">Rule Sets</a>.
      </p>
    </div>
  );
}
