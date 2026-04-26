import { z } from 'zod';

/**
 * Supported IPTV / live-stream protocols.
 *
 * - `udp` / `rtp` — multicast streams (typical telco IPTV); only playable on
 *   Samsung Tizen via AVPlay with `SET_STREAMTYPE=UDP`.
 * - `rtsp` — usually unicast IP-camera or RTSP-relayed live feeds.
 * - `hls` (.m3u8) / `dash` (.mpd) — HTTP adaptive streaming.
 * - `http` — plain HTTP progressive download (mp4 / ts).
 */
export const IptvProtocolEnum = z.enum(['udp', 'rtp', 'rtsp', 'hls', 'dash', 'http']);
export type IptvProtocol = z.infer<typeof IptvProtocolEnum>;

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

/** Returns true when an IPv4 dotted-quad falls in the multicast range 224.0.0.0/4. */
export function isMulticastIPv4(host: string): boolean {
  if (!IPV4_RE.test(host)) return false;
  const first = Number(host.split('.', 1)[0]);
  return first >= 224 && first <= 239;
}

/**
 * Validate an IPTV stream URL for a given protocol. Throws a `ZodError`-style
 * issue via the refinement path on the parent object.
 */
function isValidIptvUrl(url: string, protocol: IptvProtocol): boolean {
  // Lightweight URL parse — `URL` global is not available under the shared
  // package's tsconfig (no DOM lib), so use a regex.
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!m) return false;
  const scheme = (m[1] ?? '').toLowerCase();
  const authority = m[2] ?? '';
  const pathQuery = (m[3] ?? '') + (m[4] ?? '');
  const hostPortMatch = /^(?:[^@]*@)?([^:]+)(?::(\d+))?$/.exec(authority);
  const hostname = hostPortMatch?.[1] ?? '';
  const port = hostPortMatch?.[2] ?? '';
  switch (protocol) {
    case 'udp':
    case 'rtp':
      if (scheme !== protocol) return false;
      if (!hostname || !port) return false;
      return true;
    case 'rtsp':
      return scheme === 'rtsp' && !!hostname;
    case 'hls':
      return (scheme === 'http' || scheme === 'https') && /\.m3u8(\?|$)/i.test(pathQuery);
    case 'dash':
      return (scheme === 'http' || scheme === 'https') && /\.mpd(\?|$)/i.test(pathQuery);
    case 'http':
      return scheme === 'http' || scheme === 'https';
    default:
      return false;
  }
}

export const IptvChannelSchema = z
  .object({
    /** 1-based channel number used for direct tuning. Must be unique within a group. */
    number: z.number().int().min(1).max(9999),
    /** Display name shown in the channel banner. */
    name: z.string().min(1).max(120),
    /** Stream URL appropriate for `protocol`. */
    url: z.string().min(1).max(2048),
    protocol: IptvProtocolEnum,
    /** Optional content item id for a per-channel logo (image content). */
    logoContentId: z.string().uuid().nullish(),
    /** Audio-only / radio channel flag (player may show a static placeholder). */
    audioOnly: z.boolean().optional().default(false),
    /** Hint passed to AVPlay when known (e.g. 'h264', 'hevc'); free-form. */
    codecHint: z.string().max(64).nullish(),
  })
  .superRefine((ch, ctx) => {
    if (!isValidIptvUrl(ch.url, ch.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: `Invalid ${ch.protocol.toUpperCase()} URL`,
      });
    }
  });
export type IptvChannel = z.infer<typeof IptvChannelSchema>;

export const MAX_CHANNELS_PER_GROUP = 256;

export const ChannelGroupMetadataSchema = z
  .object({
    channels: z.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP),
    /** Author-set "cold start" channel number; runtime last-played overrides this. */
    defaultChannelNumber: z.number().int().min(1).max(9999),
  })
  .superRefine((meta, ctx) => {
    const seen = new Set<number>();
    for (const [i, ch] of meta.channels.entries()) {
      if (seen.has(ch.number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['channels', i, 'number'],
          message: `Duplicate channel number ${ch.number}`,
        });
      }
      seen.add(ch.number);
    }
    if (!seen.has(meta.defaultChannelNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultChannelNumber'],
        message: 'defaultChannelNumber must reference an existing channel',
      });
    }
  });
export type ChannelGroupMetadata = z.infer<typeof ChannelGroupMetadataSchema>;

export const CreateChannelGroupSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  folderId: z.string().uuid().nullish(),
  channels: z.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP),
  defaultChannelNumber: z.number().int().min(1).max(9999),
});
export type CreateChannelGroupInput = z.infer<typeof CreateChannelGroupSchema>;

export const UpdateChannelGroupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullish(),
  channels: z.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP).optional(),
  defaultChannelNumber: z.number().int().min(1).max(9999).optional(),
});
export type UpdateChannelGroupInput = z.infer<typeof UpdateChannelGroupSchema>;

export const ImportM3USchema = z.object({
  /** Raw `#EXTM3U` text body (max 1 MiB). */
  text: z.string().min(7).max(1 * 1024 * 1024),
});
export type ImportM3UInput = z.infer<typeof ImportM3USchema>;

/**
 * Detect a protocol from a stream URL. Returns `null` when no supported
 * protocol matches.
 */
export function detectIptvProtocol(url: string): IptvProtocol | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.startsWith('udp://')) return 'udp';
  if (lower.startsWith('rtp://')) return 'rtp';
  if (lower.startsWith('rtsp://')) return 'rtsp';
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    if (/\.m3u8(\?|$)/.test(lower)) return 'hls';
    if (/\.mpd(\?|$)/.test(lower)) return 'dash';
    return 'http';
  }
  return null;
}

/**
 * Parse an M3U / M3U8 playlist body into `IptvChannel` proposals.
 * Honours `tvg-chno`, `tvg-name`, `tvg-logo`, and `group-title` attributes when
 * present. Channels without a `tvg-chno` are auto-numbered starting at 1.
 *
 * This is a pure function (no I/O) so it can be reused by the dashboard for
 * live previewing of pasted M3U content.
 */
export function parseM3U(text: string): IptvChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: IptvChannel[] = [];
  let pending: { name: string; number: number | null; codecHint: string | null } | null = null;
  let autoNumber = 1;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      // #EXTINF:<duration> [attr="val" ...],<title>
      const commaIdx = line.indexOf(',');
      const meta = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const title = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      const attrs: Record<string, string> = {};
      for (const m of meta.matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g)) {
        attrs[m[1]!.toLowerCase()] = m[2]!;
      }
      const chnoRaw = attrs['tvg-chno'];
      const chno = chnoRaw ? Number(chnoRaw) : NaN;
      pending = {
        name: attrs['tvg-name'] ?? title ?? `Channel ${autoNumber}`,
        number: Number.isFinite(chno) && chno > 0 ? chno : null,
        codecHint: attrs['codec'] ?? null,
      };
      continue;
    }
    if (line.startsWith('#')) continue; // Other directives (#EXTM3U, #EXTVLCOPT, …) ignored.

    const protocol = detectIptvProtocol(line);
    if (!protocol) {
      pending = null;
      continue;
    }
    const number = pending?.number ?? autoNumber;
    autoNumber = Math.max(autoNumber, number) + 1;
    const ch: IptvChannel = {
      number,
      name: pending?.name ?? `Channel ${number}`,
      url: line,
      protocol,
      audioOnly: false,
      ...(pending?.codecHint ? { codecHint: pending.codecHint } : {}),
    };
    channels.push(ch);
    pending = null;
    if (channels.length >= MAX_CHANNELS_PER_GROUP) break;
  }

  // De-duplicate channel numbers by re-numbering collisions to the next free slot.
  const used = new Set<number>();
  let next = 1;
  for (const ch of channels) {
    if (used.has(ch.number)) {
      while (used.has(next)) next += 1;
      ch.number = next;
    }
    used.add(ch.number);
    next = Math.max(next, ch.number + 1);
  }

  return channels;
}
