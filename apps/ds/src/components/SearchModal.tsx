import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, FileImage, Layers, CalendarDays, Monitor, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

interface SearchResult {
  id: string;
  name: string;
  entityType: 'content' | 'playlist' | 'schedule' | 'device';
  status?: string;
  mimeType?: string;
  location?: string;
  createdAt: string;
}

interface SearchResults {
  content: SearchResult[];
  playlists: SearchResult[];
  schedules: SearchResult[];
  devices: SearchResult[];
}

const ENTITY_ICONS = {
  content: FileImage,
  playlist: Layers,
  schedule: CalendarDays,
  device: Monitor,
} as const;

const ENTITY_LABELS = {
  content: 'Content',
  playlist: 'Playlist',
  schedule: 'Schedule',
  device: 'Device',
} as const;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface SearchModalProps {
  workspaceId: string;
  wsId: string;
  onClose: () => void;
}

export default function SearchModal({ workspaceId, wsId, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['search', workspaceId, debouncedQuery],
    queryFn: () =>
      api.get(`/search?q=${encodeURIComponent(debouncedQuery)}&workspaceId=${workspaceId}`),
    enabled: debouncedQuery.trim().length >= 1,
    staleTime: 10_000,
  });

  const allResults: SearchResult[] = data
    ? [...data.content, ...data.playlists, ...data.schedules, ...data.devices]
    : [];

  const navigateTo = useCallback(
    (result: SearchResult) => {
      onClose();
      switch (result.entityType) {
        case 'content':
          navigate(`/workspaces/${wsId}/content`);
          break;
        case 'playlist':
          navigate(`/workspaces/${wsId}/playlist/${result.id}`);
          break;
        case 'schedule':
          navigate(`/workspaces/${wsId}/schedule/${result.id}`);
          break;
        case 'device':
          navigate(`/workspaces/${wsId}/devices/${result.id}`);
          break;
      }
    },
    [navigate, wsId, onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = allResults[selectedIndex];
      if (result) navigateTo(result);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  // Reset selected index when results change
  useEffect(() => setSelectedIndex(0), [allResults.length]);

  const groups: { label: string; key: keyof SearchResults }[] = [
    { label: 'Content', key: 'content' },
    { label: 'Playlists', key: 'playlists' },
    { label: 'Schedules', key: 'schedules' },
    { label: 'Devices', key: 'devices' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--modal-bg)', border: '1px solid var(--card-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--card-border)' }}
        >
          {isFetching ? (
            <Loader2 size={18} className="shrink-0 text-[var(--text-muted)] animate-spin" />
          ) : (
            <Search size={18} className="shrink-0 text-[var(--text-muted)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search content, playlists, schedules, devices…"
            className="flex-1 bg-transparent text-[var(--text)] placeholder-[var(--text-muted)] text-base outline-none"
          />
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        {debouncedQuery.trim() && (
          <div className="max-h-[50vh] overflow-y-auto">
            {allResults.length === 0 && !isFetching && (
              <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
                No results for "{debouncedQuery}"
              </div>
            )}

            {groups.map(({ label, key }) => {
              const items = data?.[key] ?? [];
              if (items.length === 0) return null;

              // Compute cumulative index offset for keyboard nav
              const groupOffset =
                key === 'content' ? 0
                : key === 'playlists' ? (data?.content.length ?? 0)
                : key === 'schedules' ? (data?.content.length ?? 0) + (data?.playlists.length ?? 0)
                : (data?.content.length ?? 0) + (data?.playlists.length ?? 0) + (data?.schedules.length ?? 0);

              return (
                <div key={key}>
                  <div
                    className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg2)' }}
                  >
                    {label}
                  </div>
                  {items.map((result, i) => {
                    const globalIdx = groupOffset + i;
                    const Icon = ENTITY_ICONS[result.entityType];
                    const isSelected = selectedIndex === globalIdx;
                    return (
                      <button
                        key={result.id}
                        className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors"
                        style={{
                          background: isSelected ? 'var(--blue)' : 'transparent',
                          color: isSelected ? 'white' : 'var(--text)',
                        }}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        onClick={() => navigateTo(result)}
                      >
                        <Icon size={15} className="shrink-0 opacity-70" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{result.name}</p>
                          {result.location && (
                            <p className="text-xs opacity-60 truncate">{result.location}</p>
                          )}
                        </div>
                        {result.status && (
                          <span className="text-xs px-2 py-0.5 rounded-full opacity-70 capitalize" style={{ background: 'rgba(255,255,255,0.1)' }}>
                            {result.status}
                          </span>
                        )}
                        <span className="text-[10px] opacity-50 shrink-0">{ENTITY_LABELS[result.entityType]}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        <div
          className="px-5 py-2.5 flex items-center gap-4 text-[10px]"
          style={{ borderTop: '1px solid var(--card-border)', color: 'var(--text-muted)' }}
        >
          <span><kbd className="font-mono bg-white/10 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-white/10 px-1 rounded">↵</kbd> open</span>
          <span><kbd className="font-mono bg-white/10 px-1 rounded">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
