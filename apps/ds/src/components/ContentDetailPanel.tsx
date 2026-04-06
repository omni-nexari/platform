import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  X, Monitor, Eye, Download, MoreVertical, Plus, Check,
  XCircle, Clock, AlertTriangle, Copy, Trash2,
  Image as ImageIcon, Video, Code2, FileText, Presentation,
  Globe, Film, Tag as TagIcon, Calendar, LayoutGrid, Pencil,
} from 'lucide-react';
import { api, buildApiUrl } from '../lib/api.js';
import { useAuthStore } from '../lib/auth.js';
import AuthImg from './AuthImg.js';
import AssignedTagPills, { type AssignedTag } from './AssignedTagPills.js';
import DevicePickerModal from './DevicePickerModal.js';
import WorkspaceTagPicker from './WorkspaceTagPicker.js';

const APPROVE_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager']);
import ConfirmDialog from './ConfirmDialog.js';
import { ActionButton, Badge, Callout } from './UiPrimitives.js';

// ── Zone panel preview ────────────────────────────────────────────────────────
const ZONE_DW = 1920;
const ZONE_DH = 1080;
function ZonePanelPreview({ item }: { item: { metadata: string } }) {
  type ZSrc = { type: string; contentId?: string; contentName?: string; contentType?: string; playlistName?: string; sourceDuration?: number | null } | null | undefined;
  type ZEntry = { id?: string; rect?: { x: number; y: number; width: number; height: number }; source?: ZSrc };
  let zones: ZEntry[] = [];
  try { zones = JSON.parse(item.metadata ?? '{}').zones ?? []; } catch { /* */ }
  if (zones.length === 0) return <LayoutGrid size={32} className="text-teal-400" />;
  return (
    <div className="relative w-full h-full bg-[#0d1117]">
      {zones.map((z, i) => {
        if (!z.rect) return null;
        const left   = `${(z.rect.x / ZONE_DW) * 100}%`;
        const top    = `${(z.rect.y / ZONE_DH) * 100}%`;
        const width  = `${(z.rect.width / ZONE_DW) * 100}%`;
        const height = `${(z.rect.height / ZONE_DH) * 100}%`;
        const src = z.source;
        const isContentSrc = src?.type === 'content' && src.contentId;
        const label = src?.playlistName ?? src?.contentName ?? 'Empty';
        return (
          <div key={z.id ?? i} className="absolute overflow-hidden" style={{ left, top, width, height, border: '1px solid rgba(255,255,255,0.1)' }}>
            {isContentSrc && src?.contentId ? (
              <AuthImg itemId={src.contentId} alt={label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#1a2234]">
                <span className="text-[8px] text-slate-400 truncate px-1">{label}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ContentDetail {
  id: string;
  name: string;
  type: 'image' | 'video' | 'html5' | 'pdf' | 'presentation' | 'web_url' | 'zone_layout';
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: string;
  assignedTags?: AssignedTag[];
  webUrl: string | null;
  refreshInterval: number | null;
  filePath: string | null;
  thumbnailPath: string | null;
  originalName: string | null;
  description: string | null;
  orientation: string;
  validFrom: string | null;
  validUntil: string | null;
  approvalState: string;
  reviewNote: string | null;
  reviewerName: string | null;
  metadata: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: string | null;
  uploaderName: string | null;
}

interface Props {
  itemId: string | null;
  workspaceId: string;
  onClose: () => void;
  onDeleted: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const TYPE_META: Record<ContentDetail['type'], { label: string; color: string; icon: React.ReactNode }> = {
  image:        { label: 'Image',    color: 'bg-sky-500/80',     icon: <ImageIcon size={10} /> },
  video:        { label: 'Video',    color: 'bg-violet-500/80',  icon: <Video size={10} /> },
  html5:        { label: 'HTML5',    color: 'bg-amber-500/80',   icon: <Code2 size={10} /> },
  pdf:          { label: 'PDF',      color: 'bg-red-500/80',     icon: <FileText size={10} /> },
  presentation: { label: 'PPTX',    color: 'bg-orange-500/80',  icon: <Presentation size={10} /> },
  web_url:      { label: 'Web URL',      color: 'bg-emerald-500/80', icon: <Globe size={10} /> },
  zone_layout:  { label: 'Zone Layout',  color: 'bg-teal-500/80',    icon: <LayoutGrid size={10} /> },
};

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '');
}

function mimeToFormat(mime: string | null, type: string): string {
  if (type === 'web_url') return 'URL';
  if (type === 'html5') return 'ZIP';
  if (!mime) return '—';
  const sub = mime.split('/')[1] ?? mime;
  return sub.toUpperCase()
    .replace('X-', '')
    .replace('QUICKTIME', 'MOV')
    .replace('X-MSVIDEO', 'AVI')
    .replace('VND.OPENXMLFORMATS-OFFICEDOCUMENT.PRESENTATIONML.PRESENTATION', 'PPTX');
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

function formatFps(fps: number): string {
  return Number.isInteger(fps) ? `${fps} fps` : `${fps.toFixed(2)} fps`;
}

function TypePlaceholder({ type }: { type: ContentDetail['type'] }) {
  if (type === 'html5') {
    return (
      <div className="flex flex-col items-center gap-2">
        <Code2 size={28} className="text-amber-400/60" />
        <span className="text-amber-400 font-bold text-lg tracking-widest uppercase"
          style={{ textShadow: '0 0 18px rgba(251,191,36,0.35)' }}>
          HTML5
        </span>
      </div>
    );
  }
  const iconMap: Record<ContentDetail['type'], React.ReactNode> = {
    image:        <ImageIcon size={32} className="text-sky-400" />,
    video:        <Film size={32} className="text-violet-400" />,
    html5:        <Code2 size={32} className="text-amber-400" />,
    pdf:          <FileText size={32} className="text-red-400" />,
    presentation: <Presentation size={32} className="text-orange-400" />,
    web_url:      <Globe size={32} className="text-emerald-400" />,
    zone_layout:  <LayoutGrid size={32} className="text-teal-400" />,
  };
  return <>{iconMap[type]}</>;
}

// ── Approval badge ─────────────────────────────────────────────────────────────
function ApprovalBadge({ state }: { state: string }) {
  const cfg = {
    approved:       { label: 'Approved',       tone: 'success', icon: <Check size={11} /> },
    pending_review: { label: 'Pending Review', tone: 'warning', icon: <Clock size={11} /> },
    rejected:       { label: 'Rejected',       tone: 'danger',  icon: <XCircle size={11} /> },
    draft:          { label: 'Draft',          tone: 'neutral', icon: <FileText size={11} /> },
  } as const;

  const current = cfg[state as keyof typeof cfg] ?? { label: state, tone: 'neutral' as const, icon: null };

  return (
    <Badge tone={current.tone} className="text-xs font-medium">
      {current.icon} {current.label}
    </Badge>
  );
}

// ── INFO tab ──────────────────────────────────────────────────────────────────
function InfoTab({ item, onAddTag }: { item: ContentDetail; onAddTag: () => void }) {
  const meta = TYPE_META[item.type] ?? { label: item.type, color: 'bg-slate-500/80', icon: null };
  const isExpired = item.validUntil ? new Date(item.validUntil).getTime() < Date.now() : false;
  const isExpiringSoon = item.validUntil && !isExpired
    ? new Date(item.validUntil).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    : false;

  // Parse stored media metadata
  let parsedMeta: Record<string, unknown> = {};
  try { parsedMeta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
  const videoFps     = parsedMeta['fps']        as number | undefined;
  const videoBitRate = parsedMeta['bitRate']     as number | undefined;
  const videoMaxBR   = parsedMeta['maxBitRate']  as number | undefined;
  const videoCodec         = parsedMeta['videoCodec']       as string | undefined;
  const codecProfile       = parsedMeta['codecProfile']     as string | undefined;
  const codecLevel         = parsedMeta['codecLevel']       as number | undefined;
  const html5StartPage     = parsedMeta['startPage']        as string | undefined;
  const imgExifOrientation = parsedMeta['exifOrientation']  as number | undefined;

  // Image metadata
  const imgColorSpace    = parsedMeta['colorSpace']      as string | undefined;
  const imgHasAlpha      = parsedMeta['hasAlpha']        as boolean | undefined;
  const imgDensity       = parsedMeta['density']         as number | undefined;
  const imgBitDepth      = parsedMeta['bitsPerSample']   as number | undefined;
  const imgChannels      = parsedMeta['channels']        as number | undefined;
  const imgHasProfile    = parsedMeta['hasProfile']      as boolean | undefined;

  const channelLabel = imgChannels != null
    ? ({ 1: 'Greyscale', 2: 'Greyscale+A', 3: 'RGB', 4: imgHasAlpha ? 'RGBA' : 'CMYK' } as Record<number, string>)[imgChannels] ?? `${imgChannels}ch`
    : undefined;

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Validity warning */}
      {(isExpired || isExpiringSoon) && (
        <Callout tone={isExpired ? 'danger' : 'warning'} icon={<AlertTriangle size={13} />}>
          {isExpired ? 'This content has expired' : 'Expires within 7 days'}
        </Callout>
      )}

      {/* Content Type */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Content Type</p>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-bold uppercase ${meta.color}`}>
            {meta.icon}{meta.label}
          </span>
          <span className="text-sm font-medium text-[var(--text)]">
            {mimeToFormat(item.mimeType, item.type)}
          </span>
        </div>
      </div>

      {/* Resolution */}
      {item.width != null && item.height != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Resolution</p>
          <p className="text-sm font-medium text-[var(--text)]">{item.width}×{item.height}</p>
        </div>
      )}

      {/* Frame Rate — video */}
      {item.type === 'video' && videoFps != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Frame Rate</p>
          <p className="text-sm font-medium text-[var(--text)]">{formatFps(videoFps)}</p>
        </div>
      )}

      {/* Bit Rate — video */}
      {item.type === 'video' && videoBitRate != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Bit Rate</p>
          <p className="text-sm font-medium text-[var(--text)]">
            {formatBps(videoBitRate)}
            {videoMaxBR != null && videoMaxBR !== videoBitRate && (
              <span className="text-[var(--text-muted)]"> (Max {formatBps(videoMaxBR)})</span>
            )}
          </p>
        </div>
      )}

      {/* Video Codec */}
      {item.type === 'video' && videoCodec && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Video Codec</p>
          <p className="text-sm font-medium text-[var(--text)]">
            {videoCodec}{codecProfile ? ` ${codecProfile}` : ''}{codecLevel != null ? ` Level ${codecLevel}` : ''}
          </p>
        </div>
      )}

      {/* Image — Color Space & Channels */}
      {item.type === 'image' && (imgColorSpace || channelLabel) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Color Space</p>
          <p className="text-sm font-medium text-[var(--text)]">
            {[imgColorSpace?.toUpperCase(), channelLabel].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {/* Image — Bit Depth */}
      {item.type === 'image' && imgBitDepth != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Bit Depth</p>
          <p className="text-sm font-medium text-[var(--text)]">{imgBitDepth}-bit</p>
        </div>
      )}

      {/* Image — DPI */}
      {item.type === 'image' && imgDensity != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Resolution (DPI)</p>
          <p className="text-sm font-medium text-[var(--text)]">{Math.round(imgDensity)} PPI</p>
        </div>
      )}

      {/* Image — Alpha / ICC flags */}
      {item.type === 'image' && (imgHasAlpha != null || imgHasProfile != null) && (
        <div className="flex gap-3">
          {imgHasAlpha != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Alpha</p>
              <p className="text-sm font-medium text-[var(--text)]">{imgHasAlpha ? 'Yes' : 'No'}</p>
            </div>
          )}
          {imgHasProfile != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">ICC Profile</p>
              <p className="text-sm font-medium text-[var(--text)]">{imgHasProfile ? 'Yes' : 'No'}</p>
            </div>
          )}
        </div>
      )}

      {/* HTML5 — Start Page */}
      {item.type === 'html5' && html5StartPage && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Start Page</p>
          <p className="text-sm font-medium text-[var(--text)]">{html5StartPage}</p>
        </div>
      )}

      {/* Image — EXIF Orientation */}
      {item.type === 'image' && imgExifOrientation != null && imgExifOrientation !== 1 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">EXIF Orientation</p>
          <p className="text-sm font-medium text-[var(--text)]">
            {({ 2: 'Flipped H', 3: 'Rotated 180°', 4: 'Flipped V', 6: '90° CW', 8: '90° CCW' } as Record<number, string>)[imgExifOrientation] ?? `Orientation ${imgExifOrientation}`}
          </p>
        </div>
      )}

      {/* Web URL */}
      {item.webUrl && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">URL</p>
          <p className="text-xs text-[var(--text)] break-all leading-relaxed">{item.webUrl}</p>
        </div>
      )}

      {/* Zone Layout */}
      {item.type === 'zone_layout' && (() => {
        const zonesArr = (parsedMeta['zones'] as unknown[] | undefined) ?? [];
        type ZoneEntry = { id?: string; rect?: { x: number; y: number; width: number; height: number }; source?: { type: string; playlistName?: string; contentName?: string; contentType?: string; sourceDuration?: number | null } | null; syncGroup?: string | null };
        const DEFAULT_IMG = 10;
        const zones = zonesArr as ZoneEntry[];
        const zoneDurs = zones.map((z) => {
          const src = z.source;
          if (!src || src.type === 'empty') return null;
          if (src.sourceDuration != null) return src.sourceDuration;
          if (src.type === 'content' && src.contentType === 'image') return DEFAULT_IMG;
          return null;
        });
        const totalDur = item.duration ?? (zoneDurs.some((d) => d != null) ? Math.max(...zoneDurs.filter((d): d is number => d != null)) : null);
        return (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Zones</p>
              <p className="text-sm font-medium text-[var(--text)]">{zones.length} zone{zones.length !== 1 ? 's' : ''}</p>
            </div>
            {zones.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Zone Details</p>
                <div className="space-y-2">
                  {zones.map((z, i) => {
                    const src = z.source;
                    const name = src?.playlistName ?? src?.contentName ?? (src && src.type !== 'empty' ? src.type : 'Empty');
                    const dur = zoneDurs[i];
                    const isDoc = src?.contentType != null && ['pdf', 'presentation', 'html5'].includes(src.contentType);
                    return (
                      <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[var(--text)]">Zone {i + 1}</span>
                          <div className="flex items-center gap-1">
                            {z.syncGroup && (
                              <span className="px-1 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400">{z.syncGroup}</span>
                            )}
                            {dur != null
                              ? <span className="text-[10px] text-[var(--text-muted)]">{dur < 60 ? `${dur.toFixed(1)} s` : `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`}</span>
                              : isDoc ? <span className="text-[10px] text-[var(--text-muted)]">doc</span> : null}
                          </div>
                        </div>
                        {src && src.type !== 'empty' && (
                          <p className="text-[10px] text-[var(--accent)] truncate">{name}</p>
                        )}
                        {z.rect && (
                          <p className="text-[9px] text-[var(--text-muted)]">{z.rect.width}×{z.rect.height} @ {z.rect.x},{z.rect.y}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {totalDur != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Total Duration</p>
                <p className="text-sm font-medium text-[var(--text)]">
                  {totalDur < 60 ? `${totalDur.toFixed(1)} s` : `${Math.floor(totalDur / 60)}:${String(Math.floor(totalDur % 60)).padStart(2, '0')}`}
                  {item.duration == null && <span className="text-[10px] text-[var(--text-muted)] ml-1">(auto)</span>}
                </p>
              </div>
            )}
          </>
        );
      })()}

      {/* File Size */}
      {item.fileSize != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Size</p>
          <p className="text-sm font-medium text-[var(--text)]">{formatSize(item.fileSize)}</p>
        </div>
      )}

      {/* Duration — video */}
      {item.type === 'video' && item.duration != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Duration</p>
          <p className="text-sm font-medium text-[var(--text)]">{item.duration.toFixed(1)} s</p>
        </div>
      )}

      {/* Approval state */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Approval</p>
        <ApprovalBadge state={item.approvalState} />
        {item.approvalState === 'rejected' && item.reviewNote && (
          <Callout tone="danger" className="mt-2" icon={<XCircle size={13} />}>
            {item.reviewNote}
          </Callout>
        )}
      </div>

      {/* Validity window */}
      {(item.validFrom || item.validUntil) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Validity Window</p>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Calendar size={11} />
            <span>
              {item.validFrom ? formatDate(item.validFrom) : 'Always'}
              {' → '}
              {item.validUntil ? formatDate(item.validUntil) : 'Never'}
            </span>
          </div>
        </div>
      )}

      {/* Added by */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Added by</p>
        <p className="text-sm font-medium text-[var(--text)]">{item.uploaderName ?? '—'}</p>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Date Added</p>
          <p className="text-xs font-medium text-[var(--text)]">{formatDate(item.createdAt)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Last Updated</p>
          <p className="text-xs font-medium text-[var(--text)]">{formatDate(item.updatedAt)}</p>
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Description</p>
          <p className="text-xs text-[var(--text)] leading-relaxed whitespace-pre-line">{item.description}</p>
        </div>
      )}

      {/* Tags */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Tags</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          <AssignedTagPills tags={item.assignedTags} emptyText="No tags assigned" />
          <button
            onClick={onAddTag}
            title="Edit tags in Settings"
            className="w-6 h-6 flex items-center justify-center rounded-full border-2 border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SETTINGS tab ──────────────────────────────────────────────────────────────
function SettingsTab({
  item,
  editName, setEditName,
  editDescription, setEditDescription,
  workspaceId,
  editValidFrom, setEditValidFrom,
  editValidUntil, setEditValidUntil,
  editOrientation, setEditOrientation,
  showRejectInput, setShowRejectInput,
  rejectNote, setRejectNote,
  onSave, isSaving,
  onSubmitReview, isSubmitting,
  onApprove, isApproving,
  onReject, isRejecting,
  canApprove,
}: {
  item: ContentDetail;
  editName: string; setEditName: (v: string) => void;
  editDescription: string; setEditDescription: (v: string) => void;
  workspaceId: string;
  editValidFrom: string; setEditValidFrom: (v: string) => void;
  editValidUntil: string; setEditValidUntil: (v: string) => void;
  editOrientation: string; setEditOrientation: (v: string) => void;
  showRejectInput: boolean; setShowRejectInput: (v: boolean) => void;
  rejectNote: string; setRejectNote: (v: string) => void;
  onSave: () => void; isSaving: boolean;
  onSubmitReview: () => void; isSubmitting: boolean;
  onApprove: () => void; isApproving: boolean;
  onReject: () => void; isRejecting: boolean;
  canApprove: boolean;
}) {
  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]';
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 block';

  return (
    <div className="px-5 py-4 space-y-5 pb-24">
      {/* Name */}
      <div>
        <label className={labelCls}>Name</label>
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className={inputCls}
          placeholder="Content name…"
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          rows={3}
          placeholder="Optional description…"
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Tags */}
      <div>
        <label className={labelCls}>Tags</label>
        <WorkspaceTagPicker
          workspaceId={workspaceId}
          entityId={item.id}
          entityType="content"
          onAssignmentChange={() => {}}
        />
      </div>

      {/* Validity window */}
      <div>
        <label className={labelCls}>
          <span className="flex items-center gap-1.5"><Calendar size={11} /> Validity Window</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">From</p>
            <input
              type="date"
              value={editValidFrom}
              onChange={(e) => setEditValidFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">Until</p>
            <input
              type="date"
              value={editValidUntil}
              onChange={(e) => setEditValidUntil(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        {editValidFrom && editValidUntil && new Date(editValidFrom) > new Date(editValidUntil) && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle size={11} /> "From" must be before "Until"
          </p>
        )}
      </div>

      {/* Orientation */}
      <div>
        <label className={labelCls}>Orientation</label>
        <select
          value={editOrientation}
          onChange={(e) => setEditOrientation(e.target.value)}
          className={inputCls}
        >
          <option value="any">Any</option>
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </div>

      {/* ─── Approval Workflow ─── */}
      <div className="pt-2 border-t border-[var(--border)]">
        <p className={labelCls}>Approval</p>
        <div className="flex items-center justify-between mb-3">
          <ApprovalBadge state={item.approvalState} />
          {item.reviewerName && (
            <span className="text-xs text-[var(--text-muted)]">by {item.reviewerName}</span>
          )}
        </div>

        {/* Reviewer note */}
        {item.approvalState === 'rejected' && item.reviewNote && (
          <Callout tone="danger" className="mb-3" icon={<XCircle size={13} />}>
            <strong>Rejection note:</strong> {item.reviewNote}
          </Callout>
        )}

        {/* Approval actions */}
        <div className="space-y-2">
          {/* Submit for review (for draft/rejected) */}
          {(item.approvalState === 'draft' || item.approvalState === 'rejected') && (
            <ActionButton
              onClick={onSubmitReview}
              disabled={isSubmitting}
              tone="warning"
              className="w-full py-2 text-xs"
            >
              {isSubmitting ? 'Submitting…' : 'Submit for Review'}
            </ActionButton>
          )}

          {/* Approve / Reject (for pending_review) — managers and above only */}
          {item.approvalState === 'pending_review' && canApprove && (
            <>
              <ActionButton
                onClick={onApprove}
                disabled={isApproving}
                tone="success"
                className="w-full py-2 text-xs"
              >
                {isApproving ? 'Approving…' : '✓ Approve'}
              </ActionButton>
              <ActionButton
                onClick={() => setShowRejectInput(!showRejectInput)}
                tone="danger"
                className="w-full py-2 text-xs"
              >
                Reject…
              </ActionButton>
            </>
          )}

          {/* Pending indicator for non-approvers */}
          {item.approvalState === 'pending_review' && !canApprove && (
            <p className="text-xs text-[var(--text-muted)] italic">Awaiting review by a manager or above.</p>
          )}

          {/* Revoke Approval (for approved) — managers and above only */}
          {item.approvalState === 'approved' && canApprove && (
            <ActionButton
              onClick={() => setShowRejectInput(!showRejectInput)}
              className="w-full py-2 text-xs"
            >
              Revoke Approval…
            </ActionButton>
          )}

          {/* Reject / revoke form */}
          {showRejectInput && (
            <div className="space-y-2 pt-1">
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={2}
                placeholder="Reason (optional)…"
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--text)] resize-none focus:outline-none focus:border-[var(--accent)]"
              />
              <div className="flex gap-2">
                <ActionButton
                  onClick={onReject}
                  disabled={isRejecting}
                  tone="danger"
                  className="flex-1 py-1.5 text-xs"
                >
                  {isRejecting ? '…' : 'Confirm'}
                </ActionButton>
                <ActionButton
                  onClick={() => { setShowRejectInput(false); setRejectNote(''); }}
                  className="flex-1 py-1.5 text-xs"
                >
                  Cancel
                </ActionButton>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save button — sticky at bottom */}
      <ActionButton
        onClick={onSave}
        disabled={isSaving || (!!editValidFrom && !!editValidUntil && new Date(editValidFrom) > new Date(editValidUntil))}
        tone="primary"
        className="w-full py-2.5 text-sm"
      >
        {isSaving ? 'Saving…' : 'Save Changes'}
      </ActionButton>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ContentDetailPanel({ itemId, workspaceId, onClose, onDeleted }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'info' | 'settings'>('info');

  // Role-based capabilities — also check designated reviewer list from workspace settings
  const authUser = useAuthStore.getState().user;
  const userRole = authUser?.orgRole ?? '';
  const userId   = authUser?.id ?? '';

  const { data: wsData } = useQuery<{ settings: string }>({
    queryKey: ['workspace-settings', workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const wsSettings = (() => {
    try { return JSON.parse(wsData?.settings ?? '{}') as { approvalReviewers?: string[] }; } catch { return {}; }
  })();
  const reviewers = wsSettings.approvalReviewers ?? [];
  // prime_owner / owner always bypass the designated list
  const canApprove = APPROVE_ROLES.has(userRole) && (
    ['prime_owner', 'owner'].includes(userRole) || reviewers.length === 0 || reviewers.includes(userId)
  );

  // SETTINGS edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editValidFrom, setEditValidFrom] = useState('');
  const [editValidUntil, setEditValidUntil] = useState('');
  const [editOrientation, setEditOrientation] = useState('any');
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);

  // Fetch item details
  const { data: item, isLoading } = useQuery<ContentDetail>({
    queryKey: ['content-item', itemId],
    queryFn: () => api.get(`/content/${itemId}`),
    enabled: !!itemId,
  });

  // Sync edit state when item loads / changes
  useEffect(() => {
    if (item) {
      setEditName(item.name);
      setEditDescription(item.description ?? '');
      setEditValidFrom(item.validFrom ? item.validFrom.slice(0, 10) : '');
      setEditValidUntil(item.validUntil ? item.validUntil.slice(0, 10) : '');
      setEditOrientation(item.orientation ?? 'any');
      setShowRejectInput(false);
      setRejectNote('');
    }
  }, [item?.id]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['content', workspaceId] });
    qc.invalidateQueries({ queryKey: ['content-item', itemId] });
    qc.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
  };

  const patchMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/content/${itemId}`, data),
    onSuccess: () => { toast.success('Saved'); invalidate(); },
    onError: () => toast.error('Failed to save'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/content/${itemId}`),
    onSuccess: () => {
      toast.success('Content deleted');
      setConfirmDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['content', workspaceId] });
      qc.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
      onDeleted();
    },
    onError: () => toast.error('Failed to delete'),
  });

  const duplicateMut = useMutation({
    mutationFn: () => api.post(`/content/${itemId}/duplicate`),
    onSuccess: () => {
      toast.success('Duplicated');
      setConfirmDuplicateOpen(false);
      qc.invalidateQueries({ queryKey: ['content', workspaceId] });
    },
    onError: () => toast.error('Failed to duplicate'),
  });

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!itemId) throw new Error('Content is not available');
      return api.post('/devices/publish', {
        workspaceId,
        deviceIds,
        resourceType: 'content',
        resourceId: itemId,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setConfirmPublishOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish content'),
  });

  const submitReviewMut = useMutation({
    mutationFn: () => api.post(`/content/${itemId}/submit-review`),
    onSuccess: () => { toast.success('Submitted for review'); invalidate(); },
    onError: () => toast.error('Failed'),
  });

  const approveMut = useMutation({
    mutationFn: () => api.post(`/content/${itemId}/approve`),
    onSuccess: () => { toast.success('Approved'); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const rejectMut = useMutation({
    mutationFn: (note: string) => api.post(`/content/${itemId}/reject`, { note }),
    onSuccess: () => { toast.success('Rejected'); setShowRejectInput(false); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const handleSave = () => {
    if (editValidFrom && editValidUntil && new Date(editValidFrom) > new Date(editValidUntil)) return;
    patchMut.mutate({
      name: editName.trim() || item?.name,
      description: editDescription || null,
      orientation: editOrientation,
      validFrom: editValidFrom || null,
      validUntil: editValidUntil || null,
    });
  };

  const handleDownload = async () => {
    if (!item) return;
    try {
      const res = await fetch(buildApiUrl(`/content/${item.id}/file`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.originalName ?? item.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  };

  if (!itemId) return null;

  const hasThumbnail = item && (item.type === 'image' || item.type === 'video');
  const isZoneLayout = item?.type === 'zone_layout';

  return (
    <>
      {/* Invisible backdrop — click to close */}
      <div className="fixed inset-0 z-30" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 z-40 h-full w-[360px] flex flex-col shadow-2xl border-l border-[var(--border)] overflow-hidden"
        style={{ background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0">
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X size={16} />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-[var(--text)] truncate">
            {item?.name ?? (isLoading ? '…' : 'Content Details')}
          </h2>
        </div>

        {/* ── Thumbnail ── */}
        <div
          className="w-full shrink-0 overflow-hidden flex items-center justify-center"
          style={{
            aspectRatio: '16/9',
            background: item?.type === 'html5'
              ? 'linear-gradient(135deg, #1f1a10 0%, #0c0a06 100%)'
              : 'var(--surface-raised)',
          }}
        >
          {isLoading ? (
            <div className="w-full h-full animate-pulse bg-[var(--surface-raised)]" />
          ) : isZoneLayout && item ? (
            <ZonePanelPreview item={item} />
          ) : hasThumbnail ? (
            <AuthImg
              itemId={item.id}
              alt={item.name}
              className="w-full h-full object-contain"
            />
          ) : item ? (
            <TypePlaceholder type={item.type} />
          ) : null}
        </div>

        {/* ── Action bar ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] shrink-0">
          <ActionButton
            onClick={() => setConfirmPublishOpen(true)}
            tone="primary"
            className="flex-1"
          >
            <Monitor size={13} />
            Publish
          </ActionButton>

          {/* Edit — zone layout */}
          {item?.type === 'zone_layout' && (
            <ActionButton
              title="Edit Layout"
              onClick={() => navigate(`/workspaces/${workspaceId}/zone-layout/${item.id}`)}
              className="px-2.5"
            >
              <Pencil size={14} />
            </ActionButton>
          )}

          {/* Eye — open preview */}
          {item?.filePath && (
            <ActionButton
              title="Preview"
              onClick={async () => {
                if (!item) return;
                const res = await fetch(buildApiUrl(`/content/${item.id}/file`), {
                  credentials: 'include',
                });
                const blob = await res.blob();
                window.open(URL.createObjectURL(blob), '_blank');
              }}
              className="px-2.5"
            >
              <Eye size={14} />
            </ActionButton>
          )}

          {/* Download */}
          {item?.filePath && (
            <ActionButton title="Download" onClick={handleDownload}
              className="px-2.5"
            >
              <Download size={14} />
            </ActionButton>
          )}

          {/* ⋮ menu */}
          <div className="relative">
            <ActionButton
              onClick={() => setMenuOpen((v) => !v)}
              className="px-2.5"
            >
              <MoreVertical size={14} />
            </ActionButton>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-50 w-40 rounded-xl shadow-xl border border-[var(--border)] py-1" style={{ background: 'var(--modal-bg)' }}>
                <button
                  onClick={() => { setMenuOpen(false); setConfirmDuplicateOpen(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-raised)]"
                >
                  <Copy size={12} /> Duplicate
                </button>
                <div className="my-1 border-t border-[var(--border)]" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-[var(--surface-raised)]"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete Content"
          message={`Delete "${item?.name ?? 'this item'}"? This cannot be undone.`}
          confirmLabel="Delete"
          confirmPendingLabel="Deleting…"
          isConfirming={deleteMut.isPending}
          closeOnConfirm={false}
          onConfirm={() => deleteMut.mutate()}
          onClose={() => setConfirmDeleteOpen(false)}
        />

        <ConfirmDialog
          open={confirmDuplicateOpen}
          title="Duplicate Content"
          message={`Create a copy of "${item?.name ?? 'this item'}"?`}
          confirmLabel="Duplicate"
          confirmPendingLabel="Duplicating…"
          variant="primary"
          icon={<Copy size={16} />}
          isConfirming={duplicateMut.isPending}
          closeOnConfirm={false}
          onConfirm={() => duplicateMut.mutate()}
          onClose={() => setConfirmDuplicateOpen(false)}
        />

        <DevicePickerModal
          open={confirmPublishOpen}
          onClose={() => setConfirmPublishOpen(false)}
          onSelect={(devices) => publishMut.mutate(devices.map((device) => device.id))}
          workspaceId={workspaceId}
          title={`Publish ${item?.name ?? 'Content'}`}
          confirmLabel={publishMut.isPending ? 'Publishing…' : 'Publish'}
        />

        {/* ── Tabs ── */}
        <div className="flex border-b border-[var(--border)] shrink-0">
          {(['info', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative flex-1 py-2.5 text-xs font-semibold tracking-wide uppercase transition-all
                ${tab === t
                  ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
            >
              {t}
              {/* Pending review indicator on settings tab */}
              {t === 'settings' && item?.approvalState === 'pending_review' && (
                <span className="absolute top-2 right-6 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-5 space-y-5">
              {[80, 60, 100, 70, 90].map((w, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-2.5 w-16 rounded bg-[var(--surface-raised)] animate-pulse" />
                  <div className={`h-4 w-${w < 80 ? '24' : '32'} rounded bg-[var(--surface-raised)] animate-pulse`} />
                </div>
              ))}
            </div>
          ) : item ? (
            tab === 'info' ? (
              <InfoTab item={item} onAddTag={() => setTab('settings')} />
            ) : (
              <SettingsTab
                item={item}
                editName={editName} setEditName={setEditName}
                editDescription={editDescription} setEditDescription={setEditDescription}
                workspaceId={workspaceId}
                editValidFrom={editValidFrom} setEditValidFrom={setEditValidFrom}
                editValidUntil={editValidUntil} setEditValidUntil={setEditValidUntil}
                editOrientation={editOrientation} setEditOrientation={setEditOrientation}
                showRejectInput={showRejectInput} setShowRejectInput={setShowRejectInput}
                rejectNote={rejectNote} setRejectNote={setRejectNote}
                onSave={handleSave} isSaving={patchMut.isPending}
                onSubmitReview={() => submitReviewMut.mutate()}
                isSubmitting={submitReviewMut.isPending}
                onApprove={() => approveMut.mutate()}
                isApproving={approveMut.isPending}
                onReject={() => rejectMut.mutate(rejectNote)}
                isRejecting={rejectMut.isPending}
                canApprove={canApprove}
              />
            )
          ) : null}
        </div>
      </div>
    </>
  );
}
