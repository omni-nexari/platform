import { useRef, useEffect } from 'react';
import type { WebpageElement } from '../../../lib/canvasTypes.js';

export default function WebpageWidget({ el }: { el: WebpageElement }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-refresh support
  useEffect(() => {
    if (!el.refreshIntervalSec || el.refreshIntervalSec <= 0) return;
    const id = setInterval(() => {
      if (iframeRef.current) {
        // Reload by re-assigning src
        iframeRef.current.src = iframeRef.current.src;
      }
    }, el.refreshIntervalSec * 1000);
    return () => clearInterval(id);
  }, [el.refreshIntervalSec]);

  if (!el.url) {
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
        <span style={{ fontSize: '2em' }}>🌐</span>
        <span style={{ fontSize: '0.78em', textAlign: 'center', padding: '0 16px' }}>
          Enter a URL in the Properties panel
        </span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <iframe
        ref={iframeRef}
        src={el.url}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        title="Webpage"
      />
    </div>
  );
}
