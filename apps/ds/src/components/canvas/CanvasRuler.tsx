import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../../lib/canvasStore.js';

export const RULER_SIZE = 24; // px — keep in sync with canvasStore.ts fitCanvas rulerSize

const BG = 'rgba(18, 18, 32, 0.97)';
const FG = '#7879a0';
const FG_ZERO = '#a0a3c4';
const BORDER = '#2e2e48';

// ── Interval snapping ─────────────────────────────────────────────────────

const NICE_STEPS = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000];

function pickInterval(rawInterval: number): number {
  for (const s of NICE_STEPS) {
    if (s >= rawInterval) return s;
  }
  return NICE_STEPS[NICE_STEPS.length - 1]!;
}

// ── Horizontal ruler ──────────────────────────────────────────────────────

function drawH(
  canvas: HTMLCanvasElement,
  zoom: number,
  stageX: number,
  width: number,   // canvas element width  (containerWidth - RULER_SIZE)
  height: number,  // RULER_SIZE
) {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);

  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = BORDER;
  ctx.fillRect(0, height - 1, width, 1);

  ctx.font = `9px ui-monospace, SFMono-Regular, monospace`;
  ctx.textBaseline = 'top';

  const rawInterval = 70 / Math.max(zoom, 0.01);
  const interval = pickInterval(rawInterval);

  // canvas coord 0 is at screen X = stageX
  // ruler canvas X = stageX - RULER_SIZE (ruler canvas starts at screen X = RULER_SIZE)
  const offsetX = stageX - RULER_SIZE;
  const firstC = Math.floor(-offsetX / zoom / interval) * interval;

  for (let c = firstC; ; c += interval) {
    const rx = Math.round(offsetX + c * zoom);
    if (rx > width + 2) break;
    if (rx < -2) continue;

    const isZero = c === 0;
    ctx.fillStyle = isZero ? FG_ZERO : FG;

    // Major tick
    ctx.fillRect(rx, height - 9, 1, 9);

    // Label
    const label = String(c);
    ctx.fillText(label, rx + 2, 3);

    // Minor tick (halfway between major ticks)
    const minorRx = Math.round(rx + (interval / 2) * zoom);
    if (minorRx >= 0 && minorRx < width) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = FG;
      ctx.fillRect(minorRx, height - 5, 1, 5);
      ctx.globalAlpha = 1;
    }
  }
}

// ── Vertical ruler ────────────────────────────────────────────────────────

function drawV(
  canvas: HTMLCanvasElement,
  zoom: number,
  stageY: number,
  width: number,   // RULER_SIZE
  height: number,  // containerHeight - RULER_SIZE
) {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);

  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = BORDER;
  ctx.fillRect(width - 1, 0, 1, height);

  ctx.font = `9px ui-monospace, SFMono-Regular, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const rawInterval = 70 / Math.max(zoom, 0.01);
  const interval = pickInterval(rawInterval);

  const offsetY = stageY - RULER_SIZE;
  const firstC = Math.floor(-offsetY / zoom / interval) * interval;

  for (let c = firstC; ; c += interval) {
    const ry = Math.round(offsetY + c * zoom);
    if (ry > height + 2) break;
    if (ry < -2) continue;

    const isZero = c === 0;
    ctx.fillStyle = isZero ? FG_ZERO : FG;

    // Major tick
    ctx.fillRect(width - 9, ry, 9, 1);

    // Rotated label
    ctx.save();
    ctx.translate(width - 11, ry);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(c), 0, 0);
    ctx.restore();

    // Minor tick
    const minorRy = Math.round(ry + (interval / 2) * zoom);
    if (minorRy >= 0 && minorRy < height) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = FG;
      ctx.fillRect(width - 5, minorRy, 5, 1);
      ctx.globalAlpha = 1;
    }
  }
}

// ── Components ────────────────────────────────────────────────────────────

export function CanvasRulerH() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = useCanvasStore((s) => s.zoom);
  const stageX = useCanvasStore((s) => s.stageX);
  const containerWidth = useCanvasStore((s) => s.containerWidth);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || containerWidth <= RULER_SIZE) return;
    drawH(c, zoom, stageX, containerWidth - RULER_SIZE, RULER_SIZE);
  }, [zoom, stageX, containerWidth]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: RULER_SIZE,
        top: 0,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}

export function CanvasRulerV() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = useCanvasStore((s) => s.zoom);
  const stageY = useCanvasStore((s) => s.stageY);
  const containerHeight = useCanvasStore((s) => s.containerHeight);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || containerHeight <= RULER_SIZE) return;
    drawV(c, zoom, stageY, RULER_SIZE, containerHeight - RULER_SIZE);
  }, [zoom, stageY, containerHeight]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: 0,
        top: RULER_SIZE,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}

export function CanvasRulerCorner() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: RULER_SIZE,
        height: RULER_SIZE,
        backgroundColor: BG,
        borderRight: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        zIndex: 11,
        pointerEvents: 'none',
      }}
    />
  );
}
