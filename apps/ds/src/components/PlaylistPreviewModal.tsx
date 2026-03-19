import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Pause, Layers } from 'lucide-react';
import AuthImg from './AuthImg.js';

interface PreviewItem {
  localId: string;
  name: string;
  duration: number; // seconds
  thumbnailContentId: string | null;
  nestedPlaylistId: string | null;
}

interface PlaylistPreviewModalProps {
  open: boolean;
  onClose: () => void;
  items: PreviewItem[];
  playlistName?: string;
}

export default function PlaylistPreviewModal({
  open, onClose, items, playlistName,
}: PlaylistPreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);    // 0..100
  const [isPaused, setIsPaused] = useState(false);

  const total = items.length;
  const current = items[currentIndex];

  // Reset when opened
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setProgress(0);
      setIsPaused(false);
    }
  }, [open]);

  // Auto-advance + progress bar
  useEffect(() => {
    if (!open || isPaused || !current) return;

    const durationMs = (current.duration || 10) * 1000;
    const tickMs = 50; // ms per tick
    let elapsed = 0;

    const id = setInterval(() => {
      elapsed += tickMs;
      setProgress(Math.min((elapsed / durationMs) * 100, 100));

      if (elapsed >= durationMs) {
        setProgress(0);
        setCurrentIndex(prev => (prev < total - 1 ? prev + 1 : 0));
      }
    }, tickMs);

    return () => clearInterval(id);
  }, [open, isPaused, current, total]);

  // Reset progress when slide changes (but not when paused changes)
  useEffect(() => {
    setProgress(0);
  }, [currentIndex]);

  const goTo = useCallback((idx: number) => {
    setCurrentIndex(idx);
    setProgress(0);
  }, []);

  const goPrev = useCallback(() => goTo(currentIndex > 0 ? currentIndex - 1 : total - 1), [currentIndex, total, goTo]);
  const goNext = useCallback(() => goTo(currentIndex < total - 1 ? currentIndex + 1 : 0), [currentIndex, total, goTo]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === ' ') { e.preventDefault(); setIsPaused(v => !v); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, goPrev, goNext]);

  if (!open || !items.length) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">Preview</span>
          {playlistName && (
            <span className="text-white text-sm font-bold truncate">{playlistName}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white transition-colors ml-4 shrink-0"
          title="Close (Esc)"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {current?.nestedPlaylistId ? (
          <div className="flex flex-col items-center gap-3 text-white/40">
            <Layers size={64} />
            <p className="text-xl font-semibold text-white/70">{current.name}</p>
            <p className="text-sm text-white/40">Nested Playlist</p>
          </div>
        ) : current?.thumbnailContentId ? (
          <AuthImg
            key={current.localId}
            itemId={current.thumbnailContentId}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/40">
            <Layers size={48} />
            <p className="text-sm">{current?.name}</p>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 px-6 py-4 space-y-3">
        {/* Progress bar */}
        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Previous (←)"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setIsPaused(v => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Play / Pause (Space)"
            >
              {isPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              onClick={goNext}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Next (→)"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Item name + counter */}
          <div className="flex-1 min-w-0 text-center">
            <p className="text-white text-sm font-semibold truncate">{current?.name}</p>
            <p className="text-white/40 text-xs">{current?.duration}s</p>
          </div>

          <p className="text-white/40 text-sm tabular-nums shrink-0">
            {currentIndex + 1} / {total}
          </p>
        </div>

        {/* Dot indicators (up to 20 items) */}
        {total <= 20 && (
          <div className="flex items-center justify-center gap-1 flex-wrap">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all ${
                  i === currentIndex ? 'w-4 h-2 bg-white' : 'w-2 h-2 bg-white/25 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
