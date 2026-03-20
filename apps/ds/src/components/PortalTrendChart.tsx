import { useId, useMemo, useState } from 'react';

interface TrendPoint {
  label: string;
  value: number;
  secondary?: string;
}

export default function PortalTrendChart({
  title,
  subtitle,
  color,
  points,
  valueFormatter = (value) => value.toLocaleString(),
}: {
  title: string;
  subtitle?: string;
  color: string;
  points: TrendPoint[];
  valueFormatter?: (value: number) => string;
}) {
  const gradientId = useId();
  const width = 640;
  const height = 220;
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 26;
  const chartHeight = height - paddingTop - paddingBottom;
  const chartWidth = width - paddingX * 2;
  const normalizedPoints = points.length > 0 ? points : [{ label: 'No data', value: 0 }];
  const maxValue = Math.max(1, ...normalizedPoints.map((point) => point.value));
  const [activeIndex, setActiveIndex] = useState(Math.max(0, normalizedPoints.length - 1));

  const coordinates = useMemo(() => {
    return normalizedPoints.map((point, index) => {
      const x = normalizedPoints.length === 1
        ? width / 2
        : paddingX + (chartWidth * index) / (normalizedPoints.length - 1);
      const y = paddingTop + chartHeight - (point.value / maxValue) * chartHeight;
      return { ...point, x, y };
    });
  }, [chartHeight, chartWidth, height, maxValue, normalizedPoints, paddingTop, width]);

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1]!.x} ${height - paddingBottom} L ${coordinates[0]!.x} ${height - paddingBottom} Z`;
  const activePoint = coordinates[Math.min(activeIndex, coordinates.length - 1)]!;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: paddingTop + chartHeight - ratio * chartHeight,
    value: Math.round(maxValue * ratio),
  }));

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {subtitle ? <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p> : null}
        </div>
        <div className="tooltip-panel min-w-36 px-3 py-2 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{activePoint.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{valueFormatter(activePoint.value)}</p>
          {activePoint.secondary ? <p className="mt-1 text-xs text-[var(--text-muted)]">{activePoint.secondary}</p> : null}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label={title}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.34" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => (
            <g key={`${title}-${tick.y}`}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(255,255,255,0.09)"
                strokeDasharray="4 6"
              />
              <text x={paddingX} y={tick.y - 6} fill="var(--text-muted)" fontSize="10">
                {valueFormatter(tick.value)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

          {coordinates.map((point, index) => (
            <g key={`${point.label}-${index}`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)}>
              <circle cx={point.x} cy={point.y} r={activeIndex === index ? 7 : 5} fill={color} fillOpacity={activeIndex === index ? 0.18 : 0.12} />
              <circle cx={point.x} cy={point.y} r={activeIndex === index ? 4 : 3} fill={color} />
            </g>
          ))}
        </svg>

        <div className="mt-3 flex items-center justify-between gap-3 overflow-x-auto pb-1 text-[11px] text-[var(--text-muted)]">
          {coordinates.map((point, index) => (
            <button
              key={`${point.label}-label`}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              className="min-w-0 rounded-lg px-2 py-1 transition-colors"
              style={{
                background: activeIndex === index ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: activeIndex === index ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {point.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}