import { readFileSync, writeFileSync } from 'fs';

const file = 'c:/Users/chiho/Projects/Platform/apps/ds/src/pages/OrgDashboardPage.tsx';
let c = readFileSync(file, 'utf8');

const newCards = `// \u2500\u2500 Playlist Card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function PlaylistCard({
  total,
  active,
  published,
  onClick,
}: {
  total: number;
  active: number;
  published: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #8b5cf6, #a855f7)' }} />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(139,92,246,0.15)' }}>
              <ListVideo className="w-5 h-5" style={{ color: '#a78bfa' }} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Total Playlists</p>
            <div className="text-4xl font-bold tracking-tight mt-0.5" style={{ color: 'var(--text)' }}>{total}</div>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-1">
          {[
            { label: 'With content', count: active,         color: '#a78bfa' },
            { label: 'On screens',   count: published,      color: '#34d399' },
            { label: 'Empty',        count: total - active, color: '#475569' },
          ].map(({ label, count, color }) => (
            <div key={label}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
              </div>
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// \u2500\u2500 Schedule Card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function ScheduleCard({
  total,
  active,
  published,
  onClick,
}: {
  total: number;
  active: number;
  published: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #14b8a6, #10b981)' }} />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(20,184,166,0.15)' }}>
              <CalendarDays className="w-5 h-5" style={{ color: '#2dd4bf' }} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Total Schedules</p>
            <div className="text-4xl font-bold tracking-tight mt-0.5" style={{ color: 'var(--text)' }}>{total}</div>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-1">
          {[
            { label: 'Active',     count: active,         color: '#2dd4bf' },
            { label: 'On screens', count: published,      color: '#34d399' },
            { label: 'Inactive',   count: total - active, color: '#475569' },
          ].map(({ label, count, color }) => (
            <div key={label}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
              </div>
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

`;

// Find exact byte positions
const pcStart = c.indexOf('// \u2500\u2500 Playlist Card');
const moduleStart = c.indexOf('// \u2500\u2500 Module (Coming Soon)');

if (pcStart === -1) throw new Error('Could not find Playlist Card comment');
if (moduleStart === -1) throw new Error('Could not find Module Coming Soon comment');

console.log(`Replacing chars ${pcStart}–${moduleStart} (${moduleStart - pcStart} chars) with ${newCards.length} chars`);

const result = c.slice(0, pcStart) + newCards + c.slice(moduleStart);
writeFileSync(file, result, 'utf8');
console.log('Done! Written', result.length, 'chars');
