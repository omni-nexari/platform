import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useMemo } from 'react';
import { api } from '../../../lib/api.js';
import type { WeatherElement } from '../../../lib/canvasTypes.js';

// ── API types ────────────────────────────────────────────────────────────────

interface CurrentWeather {
  temp: number | null;
  unit: string;
  code: number;
  label: string;
  icon: string;
  wind: number | null;
  humidity: number | null;
}

interface DayForecast {
  date: string;
  code: number;
  label: string;
  icon: string;
  tempMax: number | null;
  tempMin: number | null;
}

interface HourForecast {
  time: string;
  code: number;
  icon: string;
  temp: number | null;
}

// ── Gradient per weather code ─────────────────────────────────────────────────

function conditionGradient(code: number): string {
  if (code === 0 || code === 1) return 'linear-gradient(135deg,#f97316 0%,#fbbf24 60%,#fde68a 100%)';
  if (code <= 3)                return 'linear-gradient(135deg,#64748b 0%,#94a3b8 100%)';
  if (code <= 48)               return 'linear-gradient(135deg,#334155 0%,#64748b 100%)';
  if (code <= 67)               return 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 100%)';
  if (code <= 77)               return 'linear-gradient(135deg,#e0f2fe 0%,#bae6fd 100%)';
  if (code <= 82)               return 'linear-gradient(135deg,#1e3a5f 0%,#312e81 100%)';
  if (code <= 99)               return 'linear-gradient(135deg,#1e1b4b 0%,#4c1d95 100%)';
  return 'linear-gradient(135deg,#1e293b 0%,#334155 100%)';
}

function isSnow(code: number)    { return code >= 71 && code <= 77; }
function isRain(code: number)    { return (code >= 51 && code <= 67) || (code >= 80 && code <= 82); }
function isThunder(code: number) { return code >= 95; }
function isSunny(code: number)   { return code <= 1; }

// ── CSS-based particle canvas ────────────────────────────────────────────────

function RainParticles() {
  return (
    <div className="weather-particles" aria-hidden>
      {Array.from({ length: 22 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${(i * 4.5) % 100}%`,
            top: '-8px',
            width: '1.5px',
            height: `${10 + (i % 5) * 4}px`,
            background: 'rgba(147,197,253,0.55)',
            borderRadius: '1px',
            animation: `weatherRainFall ${0.55 + (i % 7) * 0.12}s linear ${(i % 11) * 0.09}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function SnowParticles() {
  return (
    <div className="weather-particles" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${(i * 5.5) % 100}%`,
            top: `-${6 + (i % 4)}px`,
            width: `${4 + (i % 4) * 2}px`,
            height: `${4 + (i % 4) * 2}px`,
            background: 'rgba(255,255,255,0.75)',
            borderRadius: '50%',
            animation: `weatherSnowFall ${2.2 + (i % 5) * 0.5}s linear ${(i % 9) * 0.22}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function SunGlow() {
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '140%', height: '140%',
        background: 'conic-gradient(from 0deg, transparent 60%, rgba(251,191,36,0.18) 65%, transparent 70%, transparent 80%, rgba(251,191,36,0.1) 85%, transparent 90%)',
        animation: 'weatherSunSpin 8s linear infinite',
        borderRadius: '50%',
        position: 'absolute',
      }} />
    </div>
  );
}

function ThunderFlash() {
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, borderRadius: 'inherit',
      background: 'rgba(250,204,21,0.0)',
      animation: 'weatherThunderFlash 4s ease-in-out infinite',
      pointerEvents: 'none',
    }} />
  );
}

// ── Keyframes injected once ─────────────────────────────────────────────────

const WEATHER_KEYFRAMES = `
@keyframes weatherRainFall {
  0%   { transform: translateY(-10px) scaleY(1); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(110%) scaleY(0.8); opacity: 0; }
}
@keyframes weatherSnowFall {
  0%   { transform: translate(0, -10px) rotate(0deg); opacity: 0; }
  10%  { opacity: 1; }
  50%  { transform: translate(12px, 50%) rotate(180deg); }
  90%  { opacity: 0.8; }
  100% { transform: translate(-8px, 110%) rotate(360deg); opacity: 0; }
}
@keyframes weatherSunSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes weatherThunderFlash {
  0%, 85%, 100% { background: rgba(250,204,21,0); }
  86%           { background: rgba(250,204,21,0.25); }
  88%           { background: rgba(250,204,21,0); }
  90%           { background: rgba(250,204,21,0.15); }
}
@keyframes weatherFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.weather-particles { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; }
`;

function ensureKeyframes() {
  if (typeof document !== 'undefined' && !document.getElementById('weather-widget-kf')) {
    const s = document.createElement('style');
    s.id = 'weather-widget-kf';
    s.textContent = WEATHER_KEYFRAMES;
    document.head.appendChild(s);
  }
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function CurrentView({ data, textColor }: { data: CurrentWeather; textColor: string }) {
  return (
    <div style={{ animation: 'weatherFadeIn 0.4s ease both', color: textColor, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '2.6em', lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}>{data.icon}</span>
        <span style={{ fontSize: '2.8em', fontWeight: 700, letterSpacing: '-1px', lineHeight: 1, textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          {data.temp !== null ? `${Math.round(data.temp)}${data.unit}` : '—'}
        </span>
      </div>
      <div style={{ fontSize: '0.95em', fontWeight: 500, opacity: 0.95, marginTop: 2 }}>{data.label}</div>
      {(data.wind !== null || data.humidity !== null) && (
        <div style={{ display: 'flex', gap: 12, fontSize: '0.72em', opacity: 0.75, marginTop: 4 }}>
          {data.wind !== null && <span>💨 {Math.round(data.wind)} km/h</span>}
          {data.humidity !== null && <span>💧 {data.humidity}%</span>}
        </div>
      )}
    </div>
  );
}

function SevenDayView({ data, textColor }: { data: DayForecast[]; textColor: string }) {
  return (
    <div style={{ animation: 'weatherFadeIn 0.4s ease both', color: textColor, height: '100%', display: 'flex', alignItems: 'stretch', padding: '8px 4px', gap: 2, overflow: 'hidden' }}>
      {data.slice(0, 7).map((d) => {
        const weekday = new Date(d.date).toLocaleDateString('en', { weekday: 'short' });
        return (
          <div key={d.date} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 2px',
          }}>
            <span style={{ fontSize: '0.65em', opacity: 0.75, fontWeight: 600 }}>{weekday}</span>
            <span style={{ fontSize: '1.5em', lineHeight: 1 }}>{d.icon}</span>
            <span style={{ fontSize: '0.7em', fontWeight: 700 }}>{d.tempMax !== null ? `${Math.round(d.tempMax)}°` : '—'}</span>
            <span style={{ fontSize: '0.65em', opacity: 0.65 }}>{d.tempMin !== null ? `${Math.round(d.tempMin)}°` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

function HourlyView({ data, textColor }: { data: HourForecast[]; textColor: string }) {
  return (
    <div style={{ animation: 'weatherFadeIn 0.4s ease both', color: textColor, height: '100%', display: 'flex', alignItems: 'stretch', padding: '8px 4px', gap: 2, overflowX: 'auto', scrollbarWidth: 'none' }}>
      {data.slice(0, 12).map((h) => {
        const hour = new Date(h.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
        return (
          <div key={h.time} style={{
            minWidth: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 4px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.62em', opacity: 0.7 }}>{hour}</span>
            <span style={{ fontSize: '1.4em', lineHeight: 1 }}>{h.icon}</span>
            <span style={{ fontSize: '0.7em', fontWeight: 600 }}>{h.temp !== null ? `${Math.round(h.temp)}°` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main WeatherWidget ────────────────────────────────────────────────────────

export default function WeatherWidget({ el }: { el: WeatherElement }) {
  const mountedRef = useRef(false);
  if (!mountedRef.current) { ensureKeyframes(); mountedRef.current = true; }

  const units = el.unit === 'F' ? 'imperial' : 'metric';
  const queryKey = ['weather-widget', el.lat, el.lon, units, el.displayMode];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<CurrentWeather | { days: DayForecast[] } | { hours: HourForecast[] }>(
        `/content/widgets/weather?lat=${el.lat}&lon=${el.lon}&units=${units}&mode=${el.displayMode}`,
      ),
    refetchInterval: 15 * 60 * 1000,
    staleTime:       15 * 60 * 1000,
    enabled: el.lat !== 0 || el.lon !== 0,
    retry: 1,
  });

  const code = useMemo(() => {
    if (!data) return 0;
    if ('code' in data) return data.code;
    if ('days' in data) return data.days[0]?.code ?? 0;
    if ('hours' in data) return data.hours[0]?.code ?? 0;
    return 0;
  }, [data]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      borderRadius: 16,
      overflow: 'hidden',
      background: conditionGradient(code),
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Dark glass overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.22)',
        borderRadius: 'inherit',
      }} />

      {/* Particles */}
      {el.particles && !isLoading && data && (
        <>
          {isRain(code) && <RainParticles />}
          {isSnow(code) && <SnowParticles />}
          {isSunny(code) && <SunGlow />}
          {isThunder(code) && <><RainParticles /><ThunderFlash /></>}
        </>
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: el.textColor, opacity: 0.6, fontSize: '0.85em' }}>
            Loading weather…
          </div>
        )}
        {isError && !isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#fca5a5', fontSize: '0.8em', textAlign: 'center', padding: 12 }}>
            ⚠️ Set lat/lon in properties
          </div>
        )}
        {!isLoading && !isError && data && el.displayMode === 'current' && 'code' in data && (
          <CurrentView data={data as CurrentWeather} textColor={el.textColor} />
        )}
        {!isLoading && !isError && data && el.displayMode === '7day' && 'days' in data && (
          <SevenDayView data={(data as { days: DayForecast[] }).days} textColor={el.textColor} />
        )}
        {!isLoading && !isError && data && el.displayMode === 'hourly' && 'hours' in data && (
          <HourlyView data={(data as { hours: HourForecast[] }).hours} textColor={el.textColor} />
        )}
      </div>
    </div>
  );
}
