import type { YoutubeElement } from '../../../lib/canvasTypes.js';

function extractVideoId(input: string): string | null {
  if (!input.trim()) return null;
  // Match youtu.be/ID, watch?v=ID, embed/ID, shorts/ID
  const m = input.match(/(?:youtu\.be\/|watch\?v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1] ?? null;
  // If it looks like a bare 11-char video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

export default function YoutubeWidget({ el }: { el: YoutubeElement }) {
  const videoId = extractVideoId(el.url);

  if (!videoId) {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: '#0f172a',
        borderRadius: 12,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10,
        color: '#94a3b8',
        fontFamily: 'Inter, system-ui, sans-serif',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <svg viewBox="0 0 24 24" width="36" height="36" fill="#ef4444" style={{ opacity: 0.7 }}>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
        <span style={{ fontSize: '0.78em', textAlign: 'center', padding: '0 16px' }}>
          Paste a YouTube URL in the Properties panel
        </span>
      </div>
    );
  }

  const src = [
    `https://www.youtube.com/embed/${videoId}`,
    `?autoplay=${el.autoplay ? 1 : 0}`,
    `&mute=${el.muted ? 1 : 0}`,
    `&loop=${el.loop ? 1 : 0}`,
    el.loop ? `&playlist=${videoId}` : '',
    '&rel=0&modestbranding=1',
  ].join('');

  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
      <iframe
        src={src}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        title="YouTube video"
      />
    </div>
  );
}
