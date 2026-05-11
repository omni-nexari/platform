/**
 * VideoReprocessWizard — 4-step modal for re-encoding existing video content.
 *
 * Step 1 — Goal:     preset selection (Android / Shrink / Video Wall / Custom)
 * Step 2 — Target:   output disposition + video-wall group or manual N×M
 * Step 3 — Configure: codec, quality, resolution, audio, trim, rotation
 * Step 4 — Name & Confirm: naming + summary card
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X,
  Smartphone,
  HardDriveDownload,
  LayoutGrid,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { api } from '../lib/api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors VideoReprocessOptions in apps/api)
// ─────────────────────────────────────────────────────────────────────────────

type VideoCodec = 'h264' | 'h265' | 'vp9' | 'copy';
type QualityMode = 'crf' | 'bitrate';
type Resolution = 'original' | '4k' | '1080p' | '720p' | '480p' | 'custom';
type ScaleMode  = 'fit' | 'fill' | 'stretch';
type AudioCodec = 'copy' | 'aac' | 'mp3' | 'none';
type OutputTarget = 'android_variant' | 'replace_original' | 'new_item';

interface VideoReprocessOptions {
  videoCodec: VideoCodec;
  h264Profile?: 'baseline' | 'main' | 'high';
  h264Level?: '3.1' | '4.0' | '4.1' | '5.0' | '5.1' | '5.2';
  h265Profile?: 'main' | 'main10';
  qualityMode: QualityMode;
  crf?: number;
  videoBitrate?: string;
  encodePreset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  pixelFormat?: 'yuv420p' | 'yuv422p' | 'yuv444p' | 'yuv420p10le';
  framerate?: number;
  resolution: Resolution;
  customWidth?: number;
  customHeight?: number;
  scaleMode?: ScaleMode;
  trimStart?: number;
  trimEnd?: number;
  rotation?: 0 | 90 | 180 | 270;
  audioCodec: AudioCodec;
  audioBitrate?: '64k' | '128k' | '192k' | '256k' | '320k';
  audioChannels?: 'original' | '2' | '1';
  outputTarget: OutputTarget;
  outputName?: string;
  videoWall?: { cols: number; rows: number };
}

type Preset = 'android' | 'shrink' | 'wall' | 'custom';

interface WallGroup {
  id: string;
  name: string;
  type: string;
  videoWallCols: number | null;
  videoWallRows: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI helpers
// ─────────────────────────────────────────────────────────────────────────────

const INPUT = 'w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]';

function BtnGroup<T extends string | number>({
  options,
  value,
  onChange,
  small,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 px-3 transition-colors',
            small ? 'py-1 text-xs' : 'py-1.5 text-sm',
            i > 0 ? 'border-l border-[var(--border)]' : '',
            value === opt.value
              ? 'bg-[var(--blue)] text-white font-medium'
              : 'bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)]',
          ].filter(Boolean).join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-[var(--text-muted)]">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default option sets by preset
// ─────────────────────────────────────────────────────────────────────────────

function defaultOptions(preset: Preset): Omit<VideoReprocessOptions, 'outputName'> {
  switch (preset) {
    case 'android':
      return {
        videoCodec: 'h264', h264Profile: 'high', h264Level: '5.1',
        qualityMode: 'crf', crf: 20, encodePreset: 'fast',
        pixelFormat: 'yuv420p', resolution: 'original',
        audioCodec: 'aac', audioBitrate: '192k', audioChannels: 'original',
        outputTarget: 'android_variant',
      };
    case 'shrink':
      return {
        videoCodec: 'h264', h264Profile: 'main', h264Level: '4.0',
        qualityMode: 'crf', crf: 28, encodePreset: 'fast',
        pixelFormat: 'yuv420p', resolution: '1080p', scaleMode: 'fit',
        audioCodec: 'aac', audioBitrate: '128k', audioChannels: '2',
        outputTarget: 'replace_original',
      };
    case 'wall':
      return {
        videoCodec: 'h264', h264Profile: 'high', h264Level: '5.1',
        qualityMode: 'crf', crf: 20, encodePreset: 'fast',
        pixelFormat: 'yuv420p', resolution: 'original',
        audioCodec: 'aac', audioBitrate: '192k', audioChannels: 'original',
        outputTarget: 'new_item',
        videoWall: { cols: 2, rows: 2 },
      };
    default:
      return {
        videoCodec: 'h264', h264Profile: 'high', h264Level: '5.1',
        qualityMode: 'crf', crf: 20, encodePreset: 'medium',
        pixelFormat: 'yuv420p', resolution: 'original',
        audioCodec: 'aac', audioBitrate: '192k', audioChannels: 'original',
        outputTarget: 'new_item',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

function StepGoal({
  preset, onSelect,
}: {
  preset: Preset;
  onSelect: (p: Preset) => void;
}) {
  const cards: { key: Preset; icon: React.ReactNode; title: string; desc: string }[] = [
    { key: 'android',  icon: <Smartphone size={22} />,      title: 'Android Variant',   desc: 'H.264 High 5.1 8-bit variant alongside original for Android WebView' },
    { key: 'shrink',   icon: <HardDriveDownload size={22} />, title: 'Shrink & Compress', desc: 'Reduce file size to 1080p H.264 Main, replacing the original' },
    { key: 'wall',     icon: <LayoutGrid size={22} />,       title: 'Video Wall Split',  desc: 'Crop into an N×M grid of tiles, one content item per screen' },
    { key: 'custom',   icon: <SlidersHorizontal size={22} />, title: 'Custom',            desc: 'Full control over codec, quality, resolution, audio, trim, and more' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          className={[
            'text-left p-4 rounded-xl border transition-all space-y-2',
            preset === c.key
              ? 'border-[var(--blue)] bg-[var(--blue)]/10'
              : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--blue)]/40',
          ].join(' ')}
        >
          <span className={preset === c.key ? 'text-[var(--blue)]' : 'text-[var(--text-muted)]'}>{c.icon}</span>
          <p className="text-sm font-semibold text-[var(--text)]">{c.title}</p>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">{c.desc}</p>
        </button>
      ))}
    </div>
  );
}

function StepTarget({
  preset,
  opts,
  setOpts,
  workspaceId,
}: {
  preset: Preset;
  opts: VideoReprocessOptions;
  setOpts: React.Dispatch<React.SetStateAction<VideoReprocessOptions>>;
  workspaceId: string;
}) {
  const wallGroupsQ = useQuery<WallGroup[]>({
    queryKey: ['device-groups', workspaceId],
    queryFn: () => api.get(`/device-groups?workspaceId=${workspaceId}`),
    enabled: preset === 'wall',
  });

  const wallGroups = (wallGroupsQ.data ?? []).filter(
    (g) => g.type === 'videowall' && g.videoWallCols != null && g.videoWallRows != null,
  );

  const cols = opts.videoWall?.cols ?? 2;
  const rows = opts.videoWall?.rows ?? 2;

  if (preset === 'wall') {
    return (
      <div className="space-y-5">
        {wallGroupsQ.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Loading video wall groups…</p>
        )}
        {!wallGroupsQ.isLoading && wallGroups.length > 0 && (
          <Section title="Load from existing group">
            <div className="space-y-2">
              {wallGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setOpts((o) => ({
                    ...o,
                    videoWall: { cols: g.videoWallCols!, rows: g.videoWallRows! },
                  }))}
                  className={[
                    'w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-all',
                    opts.videoWall?.cols === g.videoWallCols && opts.videoWall?.rows === g.videoWallRows
                      ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--blue)]/40',
                  ].join(' ')}
                >
                  <span>{g.name}</span>
                  <span className="text-xs font-mono">{g.videoWallCols}×{g.videoWallRows}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Manual N×M grid config */}
        <Section title="Grid dimensions">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Columns (${cols})`}>
              <input
                type="range" min={1} max={8} value={cols}
                onChange={(e) => setOpts((o) => ({ ...o, videoWall: { rows: o.videoWall?.rows ?? 2, cols: +e.target.value } }))}
                className="w-full accent-[var(--blue)]"
              />
            </Field>
            <Field label={`Rows (${rows})`}>
              <input
                type="range" min={1} max={8} value={rows}
                onChange={(e) => setOpts((o) => ({ ...o, videoWall: { cols: o.videoWall?.cols ?? 2, rows: +e.target.value } }))}
                className="w-full accent-[var(--blue)]"
              />
            </Field>
          </div>
          {/* Grid preview */}
          <div className="flex justify-center pt-1">
            <div
              className="border border-[var(--blue)]/40 rounded overflow-hidden"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                width: Math.min(cols * 56, 280),
                height: Math.min(rows * 32, 160),
              }}
            >
              {Array.from({ length: cols * rows }).map((_, i) => (
                <div key={i} className="border border-[var(--blue)]/20 bg-[var(--blue)]/5 flex items-center justify-center">
                  <span className="text-[9px] text-[var(--blue)]/60 font-mono">
                    {Math.floor(i / cols) + 1},{(i % cols) + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] text-center">
            Will create <strong className="text-[var(--text)]">{cols * rows} content items</strong> ({cols} columns × {rows} rows)
          </p>
        </Section>
      </div>
    );
  }

  // Non-wall: output target selection
  const targets: { key: OutputTarget; title: string; desc: string; badge?: string }[] = [
    {
      key: 'android_variant',
      title: 'Android Variant',
      desc: 'Save _android.mp4 alongside original. Android players auto-detect it; Tizen/web keep using the original.',
    },
    {
      key: 'replace_original',
      title: 'Replace Original',
      desc: 'Overwrite the source file in-place. All players will use the new version.',
      badge: 'Destructive',
    },
    {
      key: 'new_item',
      title: 'New Content Item',
      desc: 'Create a separate content item. Original is never modified.',
    },
  ];

  return (
    <div className="space-y-3">
      {targets.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setOpts((o) => ({ ...o, outputTarget: t.key }))}
          className={[
            'w-full text-left p-4 rounded-xl border transition-all space-y-1',
            opts.outputTarget === t.key
              ? 'border-[var(--blue)] bg-[var(--blue)]/10'
              : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--blue)]/40',
          ].join(' ')}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text)]">{t.title}</span>
            {t.badge && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--danger)]/15 text-[var(--danger)]">
                {t.badge}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t.desc}</p>
        </button>
      ))}
    </div>
  );
}

function StepConfigure({
  opts,
  setOpts,
  preset,
}: {
  opts: VideoReprocessOptions;
  setOpts: React.Dispatch<React.SetStateAction<VideoReprocessOptions>>;
  preset: Preset;
}) {
  return (
    <div className="space-y-6 overflow-y-auto pr-1" style={{ maxHeight: '62vh' }}>

      {/* ── Video ── */}
      <Section title="Video">
        <Field label="Codec">
          <BtnGroup<VideoCodec>
            options={(([
              { label: 'H.264', value: 'h264' },
              { label: 'H.265', value: 'h265' },
              { label: 'VP9',   value: 'vp9'  },
              { label: 'Copy',  value: 'copy' },
            ] as { label: string; value: VideoCodec }[]).filter((o) => !(preset === 'wall' && o.value === 'copy')))}
            value={opts.videoCodec}
            onChange={(v) => setOpts((o) => ({ ...o, videoCodec: v }))}
          />
        </Field>

        {opts.videoCodec === 'h264' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile">
              <BtnGroup
                options={[
                  { label: 'Baseline', value: 'baseline' as const },
                  { label: 'Main',     value: 'main'     as const },
                  { label: 'High',     value: 'high'     as const },
                ]}
                value={opts.h264Profile ?? 'high'}
                onChange={(v) => setOpts((o) => ({ ...o, h264Profile: v }))}
                small
              />
            </Field>
            <Field label="Level">
              <BtnGroup
                options={[
                  { label: '3.1', value: '3.1' as const },
                  { label: '4.1', value: '4.1' as const },
                  { label: '5.1', value: '5.1' as const },
                  { label: '5.2', value: '5.2' as const },
                ]}
                value={opts.h264Level ?? '5.1'}
                onChange={(v) => setOpts((o) => ({ ...o, h264Level: v }))}
                small
              />
            </Field>
          </div>
        )}

        {opts.videoCodec === 'h265' && (
          <Field label="Profile">
            <BtnGroup
              options={[
                { label: 'Main',    value: 'main'   as const },
                { label: 'Main 10', value: 'main10' as const },
              ]}
              value={opts.h265Profile ?? 'main'}
              onChange={(v) => setOpts((o) => ({ ...o, h265Profile: v }))}
              small
            />
          </Field>
        )}

        {opts.videoCodec !== 'copy' && (
          <>
            <Field label="Quality mode">
              <BtnGroup<QualityMode>
                options={[
                  { label: 'CRF (quality-based)', value: 'crf'     },
                  { label: 'Bitrate',              value: 'bitrate' },
                ]}
                value={opts.qualityMode}
                onChange={(v) => setOpts((o) => ({ ...o, qualityMode: v }))}
              />
            </Field>

            {opts.qualityMode === 'crf' && (
              <Field label={`CRF — ${opts.crf ?? 20} (lower = better quality)`}>
                <input
                  type="range" min={0} max={51} value={opts.crf ?? 20}
                  onChange={(e) => setOpts((o) => ({ ...o, crf: +e.target.value }))}
                  className="w-full accent-[var(--blue)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>0 — lossless</span><span>51 — worst</span>
                </div>
              </Field>
            )}

            {opts.qualityMode === 'bitrate' && (
              <Field label="Target bitrate (e.g. 8000k, 20M)">
                <input
                  type="text"
                  className={INPUT}
                  placeholder="8000k"
                  value={opts.videoBitrate ?? ''}
                  onChange={(e) => setOpts((o) => ({ ...o, videoBitrate: e.target.value.trim() }))}
                />
              </Field>
            )}

            <Field label="Encode speed">
              <BtnGroup
                options={[
                  { label: 'Fast',   value: 'fast'   as const },
                  { label: 'Medium', value: 'medium' as const },
                  { label: 'Slow',   value: 'slow'   as const },
                ]}
                value={opts.encodePreset ?? 'fast'}
                onChange={(v) => setOpts((o) => ({ ...o, encodePreset: v }))}
                small
              />
            </Field>

            <Field label="Pixel format">
              <BtnGroup
                options={[
                  { label: '8-bit 4:2:0', value: 'yuv420p'     as const },
                  { label: '8-bit 4:2:2', value: 'yuv422p'     as const },
                  { label: '8-bit 4:4:4', value: 'yuv444p'     as const },
                  { label: '10-bit',      value: 'yuv420p10le' as const },
                ]}
                value={opts.pixelFormat ?? 'yuv420p'}
                onChange={(v) => setOpts((o) => ({ ...o, pixelFormat: v }))}
                small
              />
            </Field>

            <Field label="Frame rate (leave blank to keep original)">
              <input
                type="number" min={1} max={120}
                className={INPUT}
                placeholder="e.g. 30, 60"
                value={opts.framerate ?? ''}
                  onChange={(e) => setOpts((o) => ({
                    ...o, framerate: e.target.value ? +e.target.value : undefined,
                  } as VideoReprocessOptions))}
              />
            </Field>
          </>
        )}
      </Section>

      {/* ── Resolution ── */}
      {opts.videoCodec !== 'copy' && (
        <Section title="Resolution">
          <Field label="Output size">
            <BtnGroup<Resolution>
              options={[
                { label: 'Original', value: 'original' },
                { label: '4K',       value: '4k'       },
                { label: '1080p',    value: '1080p'    },
                { label: '720p',     value: '720p'     },
                { label: '480p',     value: '480p'     },
                { label: 'Custom',   value: 'custom'   },
              ]}
              value={opts.resolution}
              onChange={(v) => setOpts((o) => ({ ...o, resolution: v }))}
              small
            />
          </Field>

          {opts.resolution === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (px)">
                <input
                  type="number" min={2} max={7680}
                  className={INPUT}
                  placeholder="1920"
                  value={opts.customWidth ?? ''}
                  onChange={(e) => setOpts((o) => ({
                    ...o, customWidth: e.target.value ? +e.target.value : undefined,
                  } as VideoReprocessOptions))}
                />
              </Field>
              <Field label="Height (px)">
                <input
                  type="number" min={2} max={4320}
                  className={INPUT}
                  placeholder="1080"
                  value={opts.customHeight ?? ''}
                  onChange={(e) => setOpts((o) => ({
                    ...o, customHeight: e.target.value ? +e.target.value : undefined,
                  } as VideoReprocessOptions))}
                />
              </Field>
            </div>
          )}

          {opts.resolution !== 'original' && (
            <Field label="Scale mode">
              <BtnGroup<ScaleMode>
                options={[
                  { label: 'Fit (letterbox)', value: 'fit'     },
                  { label: 'Fill (crop)',      value: 'fill'    },
                  { label: 'Stretch',          value: 'stretch' },
                ]}
                value={opts.scaleMode ?? 'fit'}
                onChange={(v) => setOpts((o) => ({ ...o, scaleMode: v }))}
                small
              />
            </Field>
          )}
        </Section>
      )}

      {/* ── Audio ── */}
      <Section title="Audio">
        <Field label="Codec">
          <BtnGroup<AudioCodec>
            options={[
              { label: 'Copy',   value: 'copy' },
              { label: 'AAC',    value: 'aac'  },
              { label: 'MP3',    value: 'mp3'  },
              { label: 'Remove', value: 'none' },
            ]}
            value={opts.audioCodec}
            onChange={(v) => setOpts((o) => ({ ...o, audioCodec: v }))}
          />
        </Field>

        {(opts.audioCodec === 'aac' || opts.audioCodec === 'mp3') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bitrate">
              <BtnGroup
                options={[
                  { label: '128k', value: '128k' as const },
                  { label: '192k', value: '192k' as const },
                  { label: '256k', value: '256k' as const },
                  { label: '320k', value: '320k' as const },
                ]}
                value={opts.audioBitrate ?? '192k'}
                onChange={(v) => setOpts((o) => ({ ...o, audioBitrate: v }))}
                small
              />
            </Field>
            <Field label="Channels">
              <BtnGroup
                options={[
                  { label: 'Original', value: 'original' as const },
                  { label: 'Stereo',   value: '2'        as const },
                  { label: 'Mono',     value: '1'        as const },
                ]}
                value={opts.audioChannels ?? 'original'}
                onChange={(v) => setOpts((o) => ({ ...o, audioChannels: v }))}
                small
              />
            </Field>
          </div>
        )}
      </Section>

      {/* ── Trim & Transform ── */}
      <Section title="Trim & Transform">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time (seconds)">
            <input
              type="number" min={0} step={0.1}
              className={INPUT}
              placeholder="0"
              value={opts.trimStart ?? ''}
              onChange={(e) => setOpts((o) => ({
                ...o, trimStart: e.target.value ? +e.target.value : undefined,
              } as VideoReprocessOptions))}
            />
          </Field>
          <Field label="End time (seconds)">
            <input
              type="number" min={0} step={0.1}
              className={INPUT}
              placeholder="end of file"
              value={opts.trimEnd ?? ''}
              onChange={(e) => setOpts((o) => ({
                ...o, trimEnd: e.target.value ? +e.target.value : undefined,
              } as VideoReprocessOptions))}
            />
          </Field>
        </div>

        <Field label="Rotation">
          <BtnGroup<0 | 90 | 180 | 270>
            options={[
              { label: 'None',  value: 0   },
              { label: '90°',   value: 90  },
              { label: '180°',  value: 180 },
              { label: '270°',  value: 270 },
            ]}
            value={opts.rotation ?? 0}
            onChange={(v) => setOpts((o) => ({ ...o, rotation: v }))}
            small
          />
        </Field>
      </Section>
    </div>
  );
}

function StepNameConfirm({
  preset,
  opts,
  setOpts,
  itemName,
}: {
  preset: Preset;
  opts: VideoReprocessOptions;
  setOpts: React.Dispatch<React.SetStateAction<VideoReprocessOptions>>;
  itemName: string;
}) {
  const isWall      = !!opts.videoWall;
  const isNewItem   = opts.outputTarget === 'new_item' && !isWall;
  const showNameField = isWall || isNewItem;

  const cols = opts.videoWall?.cols ?? 2;
  const rows = opts.videoWall?.rows ?? 2;
  const prefix = opts.outputName?.trim() || itemName;

  const targetLabel: Record<OutputTarget, string> = {
    android_variant:  'Android Variant (alongside original)',
    replace_original: 'Replace Original',
    new_item:         'New Content Item',
  };

  const codecLabel: Record<string, string> = {
    h264: 'H.264', h265: 'H.265', vp9: 'VP9', copy: 'Copy stream',
  };

  return (
    <div className="space-y-5">
      {/* Name field */}
      {showNameField && (
        <Field label={isWall ? 'Tile name prefix' : 'Content name'}>
          <input
            type="text"
            className={INPUT}
            placeholder={isWall ? itemName : `${itemName} (reprocessed)`}
            value={opts.outputName ?? ''}
            onChange={(e) => setOpts((o) => ({ ...o, outputName: e.target.value }))}
          />
          {isWall && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {Array.from({ length: Math.min(cols * rows, 12) }).map((_, i) => {
                const r = Math.floor(i / cols) + 1;
                const c = (i % cols) + 1;
                return (
                  <p key={i} className="text-xs text-[var(--text-muted)] font-mono px-1">
                    {prefix} [R{r}C{c}]
                  </p>
                );
              })}
              {cols * rows > 12 && (
                <p className="text-xs text-[var(--text-muted)] px-1 italic">…and {cols * rows - 12} more</p>
              )}
            </div>
          )}
        </Field>
      )}

      {/* Settings summary */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-4 py-2.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Summary</p>
        </div>
        <div className="px-4 py-3 space-y-2">
          {[
            ['Preset',    preset.charAt(0).toUpperCase() + preset.slice(1)],
            ['Output',    isWall ? `Video wall ${cols}×${rows} (${cols * rows} tiles)` : targetLabel[opts.outputTarget]],
            ['Codec',     codecLabel[opts.videoCodec] ?? opts.videoCodec],
            opts.videoCodec !== 'copy' && opts.h264Profile ? ['H.264 Profile', `${opts.h264Profile} L${opts.h264Level ?? '5.1'}`] : null,
            opts.videoCodec !== 'copy' ? ['Quality', opts.qualityMode === 'crf' ? `CRF ${opts.crf ?? 20}` : (opts.videoBitrate ?? 'auto')] : null,
            opts.videoCodec !== 'copy' ? ['Resolution', opts.resolution === 'custom' ? `${opts.customWidth ?? '?'}×${opts.customHeight ?? '?'}` : opts.resolution] : null,
            ['Audio',     opts.audioCodec === 'none' ? 'Removed' : opts.audioCodec === 'copy' ? 'Copy' : `${opts.audioCodec.toUpperCase()} ${opts.audioBitrate ?? ''}`],
            (opts.trimStart != null || opts.trimEnd != null) ? ['Trim', `${opts.trimStart ?? 0}s → ${opts.trimEnd != null ? `${opts.trimEnd}s` : 'end'}`] : null,
            opts.rotation ? ['Rotation', `${opts.rotation}°`] : null,
          ].filter((x): x is [string, string] => Array.isArray(x)).map(([k, v]) => (
            <div key={k as string} className="flex justify-between text-xs gap-3">
              <span className="text-[var(--text-muted)]">{k}</span>
              <span className="text-[var(--text)] font-medium text-right">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {opts.outputTarget === 'replace_original' && !isWall && (
        <div className="flex gap-2 p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
          <span>⚠</span>
          <span>The original file will be overwritten. This cannot be undone. Make sure you have a backup if needed.</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  itemId: string;
  itemName: string;
  workspaceId: string;
  onClose: () => void;
  onDone?: () => void;
}

const STEPS = ['Goal', 'Target', 'Configure', 'Name & Confirm'] as const;
type StepIndex = 0 | 1 | 2 | 3;

export default function VideoReprocessWizard({ open, itemId, itemName, workspaceId, onClose, onDone }: Props) {
  const [step,   setStep]   = useState<StepIndex>(0);
  const [preset, setPreset] = useState<Preset>('android');
  const [opts,   setOpts]   = useState<VideoReprocessOptions>(() => defaultOptions('android'));

  const reset = useCallback(() => {
    setStep(0);
    setPreset('android');
    setOpts(defaultOptions('android'));
  }, []);

  const handleSelectPreset = (p: Preset) => {
    setPreset(p);
    setOpts(defaultOptions(p));
  };

  const submitMut = useMutation({
    mutationFn: () =>
      api.post(`/content/${itemId}/reprocess`, { options: opts }),
    onSuccess: () => {
      toast.success('Reprocessing queued — results will appear when complete');
      onDone?.();
      onClose();
      setTimeout(reset, 200);
    },
    onError: () => toast.error('Failed to queue reprocessing — check server logs'),
  });

  if (!open) return null;

  const canGoNext = step < 3;
  const canGoBack = step > 0;

  const handleNext = () => {
    if (canGoNext) setStep((s) => (s + 1) as StepIndex);
  };
  const handleBack = () => {
    if (canGoBack) setStep((s) => (s - 1) as StepIndex);
  };
  const handleClose = () => {
    onClose();
    setTimeout(reset, 200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="modal-shell modal-shell-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Reprocess Video</span>
          <button onClick={handleClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-[var(--border)] px-6 gap-1 shrink-0">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={i > step}
              onClick={() => i < step && setStep(i as StepIndex)}
              className={[
                'modal-tab text-xs',
                i === step ? 'modal-tab-active' : '',
                i > step ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
              ].filter(Boolean).join(' ')}
            >
              <span className={[
                'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold mr-1.5',
                i === step ? 'bg-[var(--blue)] text-white' : i < step ? 'bg-[var(--success)] text-white' : 'bg-[var(--surface-raised)] text-[var(--text-muted)]',
              ].join(' ')}>
                {i < step ? '✓' : i + 1}
              </span>
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {step === 0 && (
            <StepGoal preset={preset} onSelect={handleSelectPreset} />
          )}
          {step === 1 && (
            <StepTarget preset={preset} opts={opts} setOpts={setOpts} workspaceId={workspaceId} />
          )}
          {step === 2 && (
            <StepConfigure opts={opts} setOpts={setOpts} preset={preset} />
          )}
          {step === 3 && (
            <StepNameConfirm preset={preset} opts={opts} setOpts={setOpts} itemName={itemName} />
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {canGoBack ? (
            <button type="button" onClick={handleBack} className="modal-secondary-btn flex items-center gap-1.5">
              <ChevronLeft size={14} /> Back
            </button>
          ) : (
            <button type="button" onClick={handleClose} className="modal-secondary-btn">Cancel</button>
          )}
          <div className="flex-1" />
          {canGoNext ? (
            <button type="button" onClick={handleNext} className="modal-primary-btn flex items-center gap-1.5">
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
              className="modal-primary-btn disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitMut.isPending ? 'Queueing…' : 'Start Reprocessing'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
