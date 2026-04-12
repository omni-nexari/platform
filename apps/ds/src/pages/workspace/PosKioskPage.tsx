import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Cpu,
  Heart,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDistanceToNow } from '../utils/time.js';
import {
  Badge,
  Callout,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface DeviceListItem {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  type: 'signage' | 'kiosk' | 'kitchen';
  lastSeen: string | null;
  playerVersion: string | null;
  publishedTarget: {
    id: string;
    type: 'content' | 'playlist' | 'schedule';
    name: string;
  } | null;
}

interface KioskHeartbeat {
  id: string;
  playerVersion: string | null;
  firmwareVersion: string | null;
  powerState: string | null;
  clockDriftMs: number | null;
  cpuLoad: number | null;
  storageFreeBytes: number | null;
  memoryFreeBytes: number | null;
  memoryTotalBytes: number | null;
  deviceUptimeSec: number | null;
  temperatureC: number | null;
  currentContentName: string | null;
  nextContentName: string | null;
  nextStartsAt: string | null;
  createdAt: string;
}

interface DeviceDetailResponse {
  device: DeviceListItem & { powerState: 'on' | 'off' | 'standby' | null };
  latestHeartbeat: KioskHeartbeat | null;
}

interface KioskLoyaltySettings {
  loyaltyEnabled: boolean;
  loyaltyPointsPerDollar: number;
  loyaltyRedemptionRate: number;
}

interface LoyaltyCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  points: number;
  tier: 'bronze' | 'silver' | 'gold';
}

interface KioskVerifyResponse extends KioskLoyaltySettings {
  found: boolean;
  customer: LoyaltyCustomer | null;
  maxRedeemablePoints: number;
}

interface KioskRedeemResponse {
  customerId: string;
  redeemedPoints: number;
  discountCents: number;
  remainingPoints: number;
  tier: LoyaltyCustomer['tier'];
}

const TIER_TONE = {
  bronze: 'neutral',
  silver: 'accent',
  gold: 'warning',
} as const;

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function formatBytes(value: number | null) {
  if (value == null) return '—';
  const gb = value / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(value / 1_048_576).toFixed(0)} MB`;
}

function formatUptime(seconds: number | null) {
  if (seconds == null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function PosKioskPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [verifyResult, setVerifyResult] = useState<KioskVerifyResponse | null>(null);
  const [redeemPoints, setRedeemPoints] = useState('');

  const { data: devices = [], isLoading: devicesLoading } = useQuery<DeviceListItem[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const kioskDevices = useMemo(() => devices.filter((device) => device.type === 'kiosk'), [devices]);

  useEffect(() => {
    if (!selectedDeviceId && kioskDevices.length > 0) {
      setSelectedDeviceId(kioskDevices[0]!.id);
    }
    if (selectedDeviceId && !kioskDevices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(kioskDevices[0]?.id ?? '');
    }
  }, [kioskDevices, selectedDeviceId]);

  const { data: deviceDetail, isLoading: deviceLoading, refetch: refetchDevice } = useQuery<DeviceDetailResponse>({
    queryKey: ['device-detail', selectedDeviceId],
    queryFn: () => api.get(`/devices/${selectedDeviceId}`),
    enabled: !!selectedDeviceId,
    refetchInterval: 30_000,
  });

  const { data: loyaltySettings } = useQuery<KioskLoyaltySettings>({
    queryKey: ['pos-kiosk-loyalty-settings', wsId],
    queryFn: () => api.get(`/pos/kiosk/loyalty/settings?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const verifyMut = useMutation({
    mutationFn: () => api.post<KioskVerifyResponse>('/pos/mgmt/kiosk/loyalty/verify', {
      workspaceId: wsId,
      phone: lookupPhone.trim() || undefined,
      email: lookupEmail.trim() || undefined,
    }),
    onSuccess: (data) => {
      setVerifyResult(data);
      if (data.found) {
        toast.success('Customer found for kiosk loyalty flow');
      } else {
        toast.warning('No loyalty customer matched that lookup');
      }
    },
    onError: () => toast.error('Failed to verify loyalty customer'),
  });

  const redeemMut = useMutation({
    mutationFn: () => {
      if (!verifyResult?.customer) {
        throw new Error('No customer selected');
      }

      return api.post<KioskRedeemResponse>('/pos/mgmt/kiosk/loyalty/redeem', {
        workspaceId: wsId,
        customerId: verifyResult.customer.id,
        points: Math.max(0, parseInt(redeemPoints, 10) || 0),
        notes: 'Operator kiosk redemption',
      });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['pos-loyalty', wsId] });
      setVerifyResult((current) => current && current.customer ? {
        ...current,
        customer: {
          ...current.customer,
          points: data.remainingPoints,
          tier: data.tier,
        },
        maxRedeemablePoints: data.remainingPoints,
      } : current);
      setRedeemPoints('');
      toast.success(`Redeemed ${data.redeemedPoints} points (${formatPrice(data.discountCents)})`);
    },
    onError: () => toast.error('Failed to redeem kiosk loyalty points'),
  });

  const heartbeat = deviceDetail?.latestHeartbeat ?? null;
  const selectedDevice = kioskDevices.find((device) => device.id === selectedDeviceId) ?? null;
  const expectedDiscount = verifyResult?.customer
    ? Math.floor((Math.max(0, parseInt(redeemPoints, 10) || 0) / Math.max(1, verifyResult.loyaltyRedemptionRate)) * 100)
    : 0;

  function handleVerify() {
    if (!lookupPhone.trim() && !lookupEmail.trim()) {
      toast.error('Enter a phone number or email to verify');
      return;
    }

    verifyMut.mutate();
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<Smartphone size={22} />}
        title="Kiosk Ops"
        subtitle="Heartbeat monitoring and kiosk loyalty simulation"
        action={
          selectedDeviceId ? (
            <button className="ui-btn-secondary flex items-center gap-1.5" onClick={() => navigate(`/workspaces/${wsId}/devices/${selectedDeviceId}`)}>
              <ArrowUpRight className="h-4 w-4" />Open Device Detail
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] gap-6">
        <SectionCard>
          <SectionCardHeader>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Kiosk Device Heartbeat</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Select a kiosk device to inspect the latest stored heartbeat and playback state.</p>
            </div>
            <button className="ui-btn-secondary text-xs" onClick={() => void refetchDevice()} disabled={!selectedDeviceId}>
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </SectionCardHeader>
          <SectionCardBody className="space-y-4">
            {devicesLoading ? (
              <Skeleton className="h-28 rounded-2xl" />
            ) : kioskDevices.length === 0 ? (
              <Callout tone="warning">No kiosk devices are registered for this workspace yet.</Callout>
            ) : (
              <>
                <select
                  value={selectedDeviceId}
                  onChange={(event) => setSelectedDeviceId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {kioskDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} · {device.status}
                    </option>
                  ))}
                </select>

                {deviceLoading ? (
                  <Skeleton className="h-56 rounded-2xl" />
                ) : selectedDevice ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={selectedDevice.status === 'online' ? 'success' : selectedDevice.status === 'offline' ? 'neutral' : selectedDevice.status === 'error' ? 'danger' : 'warning'}>
                        {selectedDevice.status}
                      </Badge>
                      <Badge tone="accent">{selectedDevice.name}</Badge>
                      <span className="text-xs text-[var(--text-muted)]">
                        {selectedDevice.lastSeen ? `Last seen ${formatDistanceToNow(selectedDevice.lastSeen)}` : 'Never connected'}
                      </span>
                    </div>

                    {heartbeat ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { label: 'Heartbeat', value: formatDistanceToNow(heartbeat.createdAt), icon: <Clock3 className="h-4 w-4" /> },
                          { label: 'Current Content', value: heartbeat.currentContentName ?? selectedDevice.publishedTarget?.name ?? 'Nothing', icon: <Activity className="h-4 w-4" /> },
                          { label: 'Next Content', value: heartbeat.nextContentName ?? 'Nothing queued', icon: <Activity className="h-4 w-4" /> },
                          { label: 'Next Start', value: heartbeat.nextStartsAt ? new Date(heartbeat.nextStartsAt).toLocaleString() : '—', icon: <Clock3 className="h-4 w-4" /> },
                          { label: 'Player Version', value: heartbeat.playerVersion ?? deviceDetail?.device.playerVersion ?? '—', icon: <Cpu className="h-4 w-4" /> },
                          { label: 'Firmware', value: heartbeat.firmwareVersion ?? '—', icon: <Cpu className="h-4 w-4" /> },
                          { label: 'Power', value: heartbeat.powerState ?? deviceDetail?.device.powerState ?? '—', icon: heartbeat.powerState === 'on' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" /> },
                          { label: 'CPU Load', value: heartbeat.cpuLoad != null ? `${heartbeat.cpuLoad.toFixed(1)}%` : '—', icon: <Cpu className="h-4 w-4" /> },
                          { label: 'Memory Free', value: formatBytes(heartbeat.memoryFreeBytes), icon: <Cpu className="h-4 w-4" /> },
                          { label: 'Memory Total', value: formatBytes(heartbeat.memoryTotalBytes), icon: <Cpu className="h-4 w-4" /> },
                          { label: 'Storage Free', value: formatBytes(heartbeat.storageFreeBytes), icon: <Activity className="h-4 w-4" /> },
                          { label: 'Uptime', value: formatUptime(heartbeat.deviceUptimeSec), icon: <Clock3 className="h-4 w-4" /> },
                          { label: 'Clock Drift', value: heartbeat.clockDriftMs != null ? `${heartbeat.clockDriftMs} ms` : '—', icon: <Clock3 className="h-4 w-4" /> },
                          { label: 'Temperature', value: heartbeat.temperatureC != null ? `${heartbeat.temperatureC.toFixed(1)} °C` : '—', icon: <Activity className="h-4 w-4" /> },
                        ].map((metric) => (
                          <div key={metric.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                              {metric.icon}
                              {metric.label}
                            </div>
                            <div className="mt-2 text-sm font-medium text-[var(--text)]">{metric.value}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Callout tone="warning">No heartbeat has been stored for this kiosk device yet.</Callout>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Kiosk Loyalty Simulator</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Runs the same verify and redeem rules used by kiosk devices, but through authenticated operator tooling.</p>
            </div>
            {loyaltySettings ? (
              <div className="flex flex-wrap gap-2">
                <Badge tone={loyaltySettings.loyaltyEnabled ? 'success' : 'neutral'}>
                  {loyaltySettings.loyaltyEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge tone="accent">{loyaltySettings.loyaltyPointsPerDollar}/$</Badge>
                <Badge tone="warning">{loyaltySettings.loyaltyRedemptionRate} pts = $1</Badge>
              </div>
            ) : null}
          </SectionCardHeader>
          <SectionCardBody className="space-y-4">
            {!loyaltySettings?.loyaltyEnabled ? (
              <Callout tone="warning">Loyalty is currently disabled for this workspace.</Callout>
            ) : null}

            <div className="grid gap-3">
              <input
                type="text"
                value={lookupPhone}
                onChange={(event) => setLookupPhone(event.target.value)}
                placeholder="Phone number"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <input
                type="email"
                value={lookupEmail}
                onChange={(event) => setLookupEmail(event.target.value)}
                placeholder="Email address"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <div className="flex justify-end">
                <button className="ui-btn-primary flex items-center gap-1.5" disabled={verifyMut.isPending} onClick={handleVerify}>
                  <Heart className="h-4 w-4" />{verifyMut.isPending ? 'Verifying…' : 'Verify Customer'}
                </button>
              </div>
            </div>

            {verifyResult ? (
              verifyResult.found && verifyResult.customer ? (
                <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{verifyResult.customer.name || 'Unnamed customer'}</span>
                    <Badge tone={TIER_TONE[verifyResult.customer.tier]} className="capitalize">{verifyResult.customer.tier}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Points</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text)]">{verifyResult.customer.points.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Redeemable</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text)]">{verifyResult.maxRedeemablePoints.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {verifyResult.customer.phone || verifyResult.customer.email || 'No contact details'}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">Redeem Points</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={redeemPoints}
                        onChange={(event) => setRedeemPoints(event.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <button className="ui-btn-primary" disabled={redeemMut.isPending} onClick={() => redeemMut.mutate()}>
                      {redeemMut.isPending ? 'Redeeming…' : 'Redeem'}
                    </button>
                  </div>

                  <div className="text-xs text-[var(--text-muted)]">
                    Estimated kiosk discount: <strong className="text-[var(--text)]">{formatPrice(expectedDiscount)}</strong>
                  </div>
                </div>
              ) : (
                <Callout tone="warning">No loyalty customer matched that kiosk lookup.</Callout>
              )
            ) : (
              <Callout tone="accent">Verify a phone number or email to test the kiosk loyalty flow from DS.</Callout>
            )}
          </SectionCardBody>
        </SectionCard>
      </div>
    </div>
  );
}