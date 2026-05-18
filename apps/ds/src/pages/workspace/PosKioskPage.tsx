import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ArrowUpRight,
  ChefHat,
  Clock3,
  Copy,
  Cpu,
  Heart,
  Key,
  Monitor,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Smartphone,
  Tablet,
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

type PosDisplaySlot = 'kiosk-portrait' | 'kiosk-landscape' | 'kitchen' | 'order-pad';

const SLOT_LABELS: Record<PosDisplaySlot, string> = {
  'kiosk-portrait':  'Kiosk — Portrait',
  'kiosk-landscape': 'Kiosk — Landscape',
  'kitchen':         'Kitchen Display',
  'order-pad':       'Waiter Tablet',
};

function parsePosSettings(settingsJson: string): { posDisplayType?: string; posWorkspaceId?: string } {
  try { return JSON.parse(settingsJson || '{}'); } catch { return {}; }
}

interface DeviceListItem {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  type: 'signage' | 'kiosk' | 'kitchen' | 'order-pad' | 'menu-board' | 'pos';
  lastSeen: string | null;
  playerVersion: string | null;
  settings: string;
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

interface DisplayTokens {
  kiosk: string | null;
  kitchen: string | null;
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

function QrCanvas({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && url) {
      void QRCode.toCanvas(canvasRef.current, url, { width: 120, margin: 1 });
    }
  }, [url]);
  return <canvas ref={canvasRef} className="rounded-xl border border-[var(--border)]" />;
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
  const [copiedType, setCopiedType] = useState<'kiosk-portrait' | 'kiosk-landscape' | 'kitchen' | 'waiter' | null>(null);
  const [deploySlot, setDeploySlot] = useState<PosDisplaySlot | null>(null);
  const [newPin, setNewPin] = useState('');

  const { data: displayTokens, refetch: refetchTokens } = useQuery<DisplayTokens>({
    queryKey: ['pos-display-tokens', wsId],
    queryFn: () => api.get(`/pos/mgmt/display-tokens?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const generateTokenMut = useMutation({
    mutationFn: (displayType: 'kiosk' | 'kitchen') =>
      api.post<{ token: string; displayType: string }>('/pos/mgmt/display-tokens', { workspaceId: wsId, displayType }),
    onSuccess: () => { void refetchTokens(); },
    onError: () => toast.error('Failed to generate display token'),
  });

  const regenerateTokenMut = useMutation({
    mutationFn: (displayType: 'kiosk' | 'kitchen') =>
      api.delete<{ token: string; displayType: string }>(`/pos/mgmt/display-tokens/${displayType}?workspaceId=${wsId}`),
    onSuccess: () => { void refetchTokens(); toast.success('Token regenerated — update the display URL on your device'); },
    onError: () => toast.error('Failed to regenerate display token'),
  });

  const { data: pinStatus, refetch: refetchPinStatus } = useQuery<{ required: boolean }>({
    queryKey: ['pos-display-pin-status', wsId],
    queryFn: () => api.get(`/pos/display/pin-status?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const setPinMut = useMutation({
    mutationFn: (pin: string) => api.put('/pos/mgmt/display-pin', { workspaceId: wsId, pin }),
    onSuccess: () => {
      setNewPin('');
      void refetchPinStatus();
      toast.success('Display PIN updated');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to set PIN'),
  });

  const removePinMut = useMutation({
    mutationFn: () => api.delete(`/pos/mgmt/display-pin?workspaceId=${wsId}`),
    onSuccess: () => {
      void refetchPinStatus();
      toast.success('Display PIN removed');
    },
    onError: () => toast.error('Failed to remove PIN'),
  });

  function buildDisplayUrl(type: 'kiosk-portrait' | 'kiosk-landscape' | 'kitchen', token: string) {
    // Kiosk/kitchen pages are served from the API server (port 3000) so the TV
    // player can load them without needing port 5174 open in the Windows Firewall.
    // The API server serves the DS production build via @fastify/static.
    const base = window.location.origin
      .replace(/:5173$/, ':3000')
      .replace(/:5174$/, ':3000');
    if (type === 'kiosk-portrait') return `${base}/kiosk/${wsId}/portrait?dt=${token}`;
    if (type === 'kiosk-landscape') return `${base}/kiosk/${wsId}/landscape?dt=${token}`;
    return `${base}/kitchen/${wsId}?dt=${token}`;
  }

  function buildPosUrl() {
    const base = window.location.origin
      .replace(/:5173$/, ':3000')
      .replace(/:5174$/, ':3000');
    return `${base}/workspaces/${wsId}/pos`;
  }

  async function copyText(text: string, type: typeof copiedType) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  }

  async function handleCopy(type: 'kiosk-portrait' | 'kiosk-landscape' | 'kitchen', token: string) {
    await copyText(buildDisplayUrl(type, token), type);
  }

  const { data: devices = [], isLoading: devicesLoading } = useQuery<DeviceListItem[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const kioskDevices = useMemo(() => devices.filter((device) => device.type === 'kiosk'), [devices]);
  const posDevices   = useMemo(
    // Only show POS-compatible devices in the deploy picker — exclude signage and menu-board
    () => devices.filter((d) => d.type !== 'signage' && d.type !== 'menu-board'),
    [devices],
  );
  const pairedDevices = useMemo(() => {
    const map: Partial<Record<PosDisplaySlot, DeviceListItem>> = {};
    for (const d of posDevices) {
      const pos = parsePosSettings(d.settings ?? '{}');
      if (pos.posDisplayType && pos.posWorkspaceId === wsId) {
        map[pos.posDisplayType as PosDisplaySlot] = d;
      }
    }
    return map;
  }, [posDevices, wsId]);

  const deployPairMut = useMutation({
    mutationFn: ({ deviceId, slot }: { deviceId: string; slot: PosDisplaySlot | null }) =>
      api.patch(`/devices/${deviceId}/pos-display`, { posDisplayType: slot, posWorkspaceId: slot ? wsId : null }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
      setDeploySlot(null);
      toast.success(vars.slot ? 'Device paired to display slot' : 'Display unlinked');
    },
    onError: () => toast.error('Failed to update display pairing'),
  });

  useEffect(() => {
    if (!selectedDeviceId && posDevices.length > 0) {
      setSelectedDeviceId(posDevices[0]!.id);
    }
    if (selectedDeviceId && !posDevices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(posDevices[0]?.id ?? '');
    }
  }, [posDevices, selectedDeviceId]);

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
          <div className="flex items-center gap-2">
            <button className="ui-btn-primary flex items-center gap-1.5" onClick={() => navigate(`/workspaces/${wsId}/pos`)}>
              <ShoppingCart className="h-4 w-4" />New Order
            </button>
            {selectedDeviceId && (
              <button className="ui-btn-secondary flex items-center gap-1.5" onClick={() => navigate(`/workspaces/${wsId}/devices/${selectedDeviceId}`)}>
                <ArrowUpRight className="h-4 w-4" />Open Device Detail
              </button>
            )}
          </div>
        }
      />

      {/* ── Display URLs ─────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Display URLs</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Generate long-lived tokens for kiosk and kitchen screens. Share the URL or scan the QR code on the display device.</p>
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Kiosk — Portrait */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text)]">Kiosk — Portrait</span>
              </div>
              {displayTokens?.kiosk ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={buildDisplayUrl('kiosk-portrait', displayTokens.kiosk)}
                      className="flex-1 truncate rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] outline-none"
                    />
                    <button
                      className="ui-btn-secondary shrink-0 flex items-center gap-1.5 text-xs"
                      onClick={() => void handleCopy('kiosk-portrait', displayTokens.kiosk!)}
                    >
                      <Copy className="h-3.5 w-3.5" />{copiedType === 'kiosk-portrait' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex items-start gap-4">
                    <QrCanvas url={buildDisplayUrl('kiosk-portrait', displayTokens.kiosk)} />
                    <button
                      className="ui-btn-secondary flex items-center gap-1.5 text-xs mt-1"
                      disabled={regenerateTokenMut.isPending}
                      onClick={() => {
                        if (window.confirm('Regenerate kiosk token? Both portrait and landscape URLs will stop working.')) {
                          regenerateTokenMut.mutate('kiosk');
                        }
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />Regenerate
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--text-muted)]">No kiosk token yet.</p>
                  <button
                    className="ui-btn-primary self-start flex items-center gap-1.5"
                    disabled={generateTokenMut.isPending}
                    onClick={() => generateTokenMut.mutate('kiosk')}
                  >
                    <Smartphone className="h-4 w-4" />{generateTokenMut.isPending ? 'Generating…' : 'Generate Kiosk URL'}
                  </button>
                </div>
              )}              <div className="pt-2 border-t border-[var(--border)]">
                {pairedDevices['kiosk-portrait'] ? (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${pairedDevices['kiosk-portrait'].status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs text-[var(--text)] truncate min-w-0">{pairedDevices['kiosk-portrait'].name}</span>
                    <button className="ml-auto shrink-0 ui-btn-secondary text-xs py-0.5 px-2" onClick={() => setDeploySlot('kiosk-portrait')}>Change</button>
                  </div>
                ) : (
                  <button className="w-full ui-btn-secondary text-xs flex items-center justify-center gap-1.5 py-1.5" onClick={() => setDeploySlot('kiosk-portrait')}>
                    <ArrowUpRight className="h-3 w-3" />Deploy to Device
                  </button>
                )}
              </div>            </div>

            {/* Kiosk — Landscape */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text)]">Kiosk — Landscape</span>
              </div>
              {displayTokens?.kiosk ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={buildDisplayUrl('kiosk-landscape', displayTokens.kiosk)}
                      className="flex-1 truncate rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] outline-none"
                    />
                    <button
                      className="ui-btn-secondary shrink-0 flex items-center gap-1.5 text-xs"
                      onClick={() => void handleCopy('kiosk-landscape', displayTokens.kiosk!)}
                    >
                      <Copy className="h-3.5 w-3.5" />{copiedType === 'kiosk-landscape' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex items-start gap-4">
                    <QrCanvas url={buildDisplayUrl('kiosk-landscape', displayTokens.kiosk)} />
                    <button
                      className="ui-btn-secondary flex items-center gap-1.5 text-xs mt-1"
                      disabled={regenerateTokenMut.isPending}
                      onClick={() => {
                        if (window.confirm('Regenerate kiosk token? Both portrait and landscape URLs will stop working.')) {
                          regenerateTokenMut.mutate('kiosk');
                        }
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />Regenerate
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Generate a kiosk token first.</p>
              )}
              <div className="pt-2 border-t border-[var(--border)]">
                {pairedDevices['kiosk-landscape'] ? (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${pairedDevices['kiosk-landscape'].status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs text-[var(--text)] truncate min-w-0">{pairedDevices['kiosk-landscape'].name}</span>
                    <button className="ml-auto shrink-0 ui-btn-secondary text-xs py-0.5 px-2" onClick={() => setDeploySlot('kiosk-landscape')}>Change</button>
                  </div>
                ) : (
                  <button className="w-full ui-btn-secondary text-xs flex items-center justify-center gap-1.5 py-1.5" onClick={() => setDeploySlot('kiosk-landscape')}>
                    <ArrowUpRight className="h-3 w-3" />Deploy to Device
                  </button>
                )}
              </div>
            </div>

            {/* Waiter Tablet */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Tablet className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text)]">Waiter Tablet</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={buildPosUrl()}
                  className="flex-1 truncate rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] outline-none"
                />
                <button
                  className="ui-btn-secondary shrink-0 flex items-center gap-1.5 text-xs"
                  onClick={() => void copyText(buildPosUrl(), 'waiter')}
                >
                  <Copy className="h-3.5 w-3.5" />{copiedType === 'waiter' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="flex items-start gap-4">
                <QrCanvas url={buildPosUrl()} />
              </div>
              <div className="pt-2 border-t border-[var(--border)]">
                {pairedDevices['order-pad'] ? (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${pairedDevices['order-pad'].status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs text-[var(--text)] truncate min-w-0">{pairedDevices['order-pad'].name}</span>
                    <button className="ml-auto shrink-0 ui-btn-secondary text-xs py-0.5 px-2" onClick={() => setDeploySlot('order-pad')}>Change</button>
                  </div>
                ) : (
                  <button className="w-full ui-btn-secondary text-xs flex items-center justify-center gap-1.5 py-1.5" onClick={() => setDeploySlot('order-pad')}>
                    <ArrowUpRight className="h-3 w-3" />Deploy to Device
                  </button>
                )}
              </div>
            </div>

            {/* Kitchen */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ChefHat className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text)]">Kitchen Display</span>
              </div>
              {displayTokens?.kitchen ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={buildDisplayUrl('kitchen', displayTokens.kitchen)}
                      className="flex-1 truncate rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] outline-none"
                    />
                    <button
                      className="ui-btn-secondary shrink-0 flex items-center gap-1.5 text-xs"
                      onClick={() => void handleCopy('kitchen', displayTokens.kitchen!)}
                    >
                      <Copy className="h-3.5 w-3.5" />{copiedType === 'kitchen' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex items-start gap-4">
                    <QrCanvas url={buildDisplayUrl('kitchen', displayTokens.kitchen)} />
                    <button
                      className="ui-btn-secondary flex items-center gap-1.5 text-xs mt-1"
                      disabled={regenerateTokenMut.isPending}
                      onClick={() => {
                        if (window.confirm('Regenerate kitchen token? The current URL will stop working.')) {
                          regenerateTokenMut.mutate('kitchen');
                        }
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />Regenerate
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--text-muted)]">No kitchen display token yet.</p>
                  <button
                    className="ui-btn-primary self-start flex items-center gap-1.5"
                    disabled={generateTokenMut.isPending}
                    onClick={() => generateTokenMut.mutate('kitchen')}
                  >
                    <ChefHat className="h-4 w-4" />{generateTokenMut.isPending ? 'Generating…' : 'Generate Kitchen URL'}
                  </button>
                </div>
              )}
              <div className="pt-2 border-t border-[var(--border)]">
                {pairedDevices['kitchen'] ? (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${pairedDevices['kitchen'].status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs text-[var(--text)] truncate min-w-0">{pairedDevices['kitchen'].name}</span>
                    <button className="ml-auto shrink-0 ui-btn-secondary text-xs py-0.5 px-2" onClick={() => setDeploySlot('kitchen')}>Change</button>
                  </div>
                ) : (
                  <button className="w-full ui-btn-secondary text-xs flex items-center justify-center gap-1.5 py-1.5" onClick={() => setDeploySlot('kitchen')}>
                    <ArrowUpRight className="h-3 w-3" />Deploy to Device
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Display PIN ─────────────────────────────────────────────── */}
          <div className="mt-6 pt-5 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <Key className="h-4 w-4 text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text)]">Display PIN</span>
              <span className="text-xs text-[var(--text-muted)]">— protects all 4 display screens</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {pinStatus?.required ? (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-green-400 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />PIN active
                  </span>
                  <button
                    className="ui-btn-secondary text-xs py-0.5 px-2 text-red-400 border-red-400/30 hover:bg-red-500/10"
                    disabled={removePinMut.isPending}
                    onClick={() => {
                      if (window.confirm('Remove the display PIN? All display screens will be open.')) {
                        removePinMut.mutate();
                      }
                    }}
                  >
                    Remove PIN
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">No PIN — open access</span>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newPin.length >= 4) setPinMut.mutate(newPin); }}
                  placeholder={pinStatus?.required ? 'New PIN (4–8 digits)' : 'Set PIN (4–8 digits)'}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-44"
                />
                <button
                  className="ui-btn-primary text-xs flex items-center gap-1.5"
                  disabled={newPin.length < 4 || setPinMut.isPending}
                  onClick={() => setPinMut.mutate(newPin)}
                >
                  <Key className="h-3.5 w-3.5" />{pinStatus?.required ? 'Update PIN' : 'Set PIN'}
                </button>
              </div>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] gap-6">
        <SectionCard>
          <SectionCardHeader>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Deployed Display Health</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Select a paired POS device to inspect its latest heartbeat and playback state.</p>
            </div>
            <button className="ui-btn-secondary text-xs" onClick={() => void refetchDevice()} disabled={!selectedDeviceId}>
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </SectionCardHeader>
          <SectionCardBody className="space-y-4">
            {devicesLoading ? (
              <Skeleton className="h-28 rounded-2xl" />
            ) : posDevices.length === 0 ? (
              <Callout tone="warning">No POS devices are registered for this workspace yet.</Callout>
            ) : (
              <>
                <select
                  value={selectedDeviceId}
                  onChange={(event) => setSelectedDeviceId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {posDevices.map((device) => {
                    const pos = parsePosSettings(device.settings ?? '{}');
                    const slotLabel = pos.posDisplayType && pos.posWorkspaceId === wsId
                      ? ` [${SLOT_LABELS[pos.posDisplayType as PosDisplaySlot] ?? pos.posDisplayType}]`
                      : '';
                    return (
                      <option key={device.id} value={device.id}>
                        {device.name}{slotLabel} · {device.status}
                      </option>
                    );
                  })}
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

      {/* ── Deploy Modal ───────────────────────────────────────── */}
      {deploySlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDeploySlot(null)}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Deploy Display</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Choose a device to pair with <strong>{SLOT_LABELS[deploySlot]}</strong></p>
              </div>
              <button className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none" onClick={() => setDeploySlot(null)}>✕</button>
            </div>
            <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
              {posDevices.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-6">
                  No devices found. Pair a device to this workspace first.
                </p>
              ) : posDevices.map((device) => {
                const isCurrentlyPaired = pairedDevices[deploySlot]?.id === device.id;
                return (
                  <button
                    key={device.id}
                    onClick={() => deployPairMut.mutate({ deviceId: device.id, slot: deploySlot })}
                    disabled={deployPairMut.isPending}
                    className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      isCurrentlyPaired
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                    }`}
                  >
                    <div className={`h-2 w-2 rounded-full shrink-0 ${device.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text)] truncate">{device.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {device.status}{device.lastSeen ? ` · ${formatDistanceToNow(device.lastSeen)} ago` : ' · Never seen'}
                      </div>
                    </div>
                    {isCurrentlyPaired && <Badge tone="accent">Paired</Badge>}
                  </button>
                );
              })}
            </div>
            {pairedDevices[deploySlot] && (
              <div className="p-4 border-t border-[var(--border)]">
                <button
                  className="w-full rounded-xl border border-red-400/30 px-3 py-2 text-xs text-red-400 hover:border-red-400/60 transition-colors"
                  onClick={() => deployPairMut.mutate({ deviceId: pairedDevices[deploySlot]!.id, slot: null })}
                  disabled={deployPairMut.isPending}
                >
                  Unlink current device
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}