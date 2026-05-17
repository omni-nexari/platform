import { useState, useEffect, useRef } from 'react';
import type { ClockElement } from '../../../lib/canvasTypes.js';

function pad(n: number) { return n.toString().padStart(2, '0'); }

function getTime(timezone: string): Date {
  if (!timezone) return new Date();
  try {
    // Use Intl to determine local time in the target timezone
    const fmt = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
    );
    return new Date(
      parseInt(parts['year'] ?? '2024', 10),
      parseInt(parts['month'] ?? '1', 10) - 1,
      parseInt(parts['day'] ?? '1', 10),
      parseInt(parts['hour'] ?? '0', 10),
      parseInt(parts['minute'] ?? '0', 10),
      parseInt(parts['second'] ?? '0', 10),
    );
  } catch {
    return new Date();
  }
}

// ── Digital face ────────────────────────────────────────────────────────────

function DigitalFace({ el, now }: { el: ClockElement; now: Date }) {
  const h24 = now.getHours();
  const min = now.getMinutes();
  const sec = now.getSeconds();

  let hourStr: string;
  let ampm: string | null = null;
  if (el.format === '12h') {
    const h = h24 % 12 || 12;
    hourStr = pad(h);
    ampm = h24 >= 12 ? 'PM' : 'AM';
  } else {
    hourStr = pad(h24);
  }

  const timeStr = `${hourStr}:${pad(min)}:${pad(sec)}`;

  const dateStr = new Intl.DateTimeFormat('en', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    ...(el.timezone ? { timeZone: el.timezone } : {}),
  }).format(now);

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '2%',
      padding: '8px 12px',
      color: el.textColor,
      fontFamily: '"JetBrains Mono", "Courier New", monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 'clamp(18px, 8cqi, 72px)', fontWeight: 700, letterSpacing: '-1px', lineHeight: 1, textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
          {timeStr}
        </span>
        {ampm && (
          <span style={{ fontSize: 'clamp(10px, 3cqi, 22px)', fontWeight: 600, opacity: 0.75 }}>{ampm}</span>
        )}
      </div>
      {el.showDate && (
        <div style={{ fontSize: 'clamp(8px, 2.2cqi, 18px)', opacity: 0.7, fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: 0.3 }}>
          {dateStr}
        </div>
      )}
    </div>
  );
}

// ── Analog face ─────────────────────────────────────────────────────────────

function AnalogFace({ el, now }: { el: ClockElement; now: Date }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();

  const hourDeg   = h * 30 + m * 0.5;
  const minuteDeg = m * 6 + s * 0.1;
  const secDeg    = s * 6;

  const cx = 50, cy = 50, r = 46;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}>
        {/* Face */}
        <circle cx={cx} cy={cy} r={r} fill={el.bgColor} stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        {/* Hour ticks */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 - 90) * (Math.PI / 180);
          const x1 = cx + r * 0.82 * Math.cos(a);
          const y1 = cy + r * 0.82 * Math.sin(a);
          const x2 = cx + r * 0.95 * Math.cos(a);
          const y2 = cy + r * 0.95 * Math.sin(a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={el.textColor} strokeWidth="1.8" strokeOpacity="0.7" />;
        })}
        {/* Hour hand */}
        <line
          x1={cx} y1={cy}
          x2={cx + 28 * Math.sin((hourDeg - 0) * Math.PI / 180)}
          y2={cy - 28 * Math.cos((hourDeg - 0) * Math.PI / 180)}
          stroke={el.textColor} strokeWidth="3.5" strokeLinecap="round"
        />
        {/* Minute hand */}
        <line
          x1={cx} y1={cy}
          x2={cx + 38 * Math.sin(minuteDeg * Math.PI / 180)}
          y2={cy - 38 * Math.cos(minuteDeg * Math.PI / 180)}
          stroke={el.textColor} strokeWidth="2.5" strokeLinecap="round"
        />
        {/* Second hand */}
        <line
          x1={cx} y1={cy}
          x2={cx + 40 * Math.sin(secDeg * Math.PI / 180)}
          y2={cy - 40 * Math.cos(secDeg * Math.PI / 180)}
          stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="2.5" fill={el.textColor} />
      </svg>
    </div>
  );
}

// ── Main ClockWidget ─────────────────────────────────────────────────────────

export default function ClockWidget({ el }: { el: ClockElement }) {
  const [now, setNow] = useState(() => getTime(el.timezone));
  const tzRef = useRef(el.timezone);
  tzRef.current = el.timezone;

  useEffect(() => {
    const id = setInterval(() => setNow(getTime(tzRef.current)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: el.bgColor,
      borderRadius: 14,
      overflow: 'hidden',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.15)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
    }}>
      {el.clockStyle === 'analog'
        ? <AnalogFace el={el} now={now} />
        : <DigitalFace el={el} now={now} />}
    </div>
  );
}
