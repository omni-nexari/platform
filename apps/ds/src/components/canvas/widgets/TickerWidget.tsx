import { useRef, useEffect } from 'react';
import type { TickerElement } from '../../../lib/canvasTypes.js';

const TICKER_KEYFRAMES_ID = 'ticker-widget-kf';

function ensureKeyframes(duration: number, direction: 'left' | 'right', id: string) {
  const styleId = `${TICKER_KEYFRAMES_ID}-${id}`;
  let el = document.getElementById(styleId);
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
    document.head.appendChild(el);
  }
  const dir = direction === 'right' ? '100%' : '-100%';
  el.textContent = `
    @keyframes tickerScroll-${id} {
      0%   { transform: translateX(${direction === 'right' ? '-100%' : '100%'}); }
      100% { transform: translateX(${dir}); }
    }
  `;
  return `tickerScroll-${id} ${duration}s linear infinite`;
}

export default function TickerWidget({ el }: { el: TickerElement }) {
  const idRef = useRef(el.id.replace(/-/g, ''));

  // Speed 1 = very slow (60s), Speed 10 = very fast (6s)
  const duration = Math.round(66 - el.speed * 6);

  useEffect(() => {
    ensureKeyframes(duration, el.direction, idRef.current);
    return () => {
      const styleEl = document.getElementById(`${TICKER_KEYFRAMES_ID}-${idRef.current}`);
      styleEl?.remove();
    };
  }, [duration, el.direction]);

  const animation = ensureKeyframes(duration, el.direction, idRef.current);
  const text = el.rssUrl ? `📡 ${el.rssUrl}` : '✏️ Add RSS URL in Properties to display headlines…  •  Breaking: Canvas widget ticker active  •  ';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: el.bgColor,
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      borderRadius: 4,
    }}>
      <div style={{
        whiteSpace: 'nowrap',
        animation,
        color: el.textColor,
        fontSize: el.fontSize,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 500,
        willChange: 'transform',
        paddingLeft: '100%',
      }}>
        {text}
      </div>
    </div>
  );
}
