import { useState } from 'react';
import { toast } from 'sonner';
import { X, Database } from 'lucide-react';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type SourceType = 'json_api' | 'rss' | 'csv' | 'google_sheets';

const SOURCE_TYPES: { id: SourceType; label: string; description: string }[] = [
  { id: 'json_api',       label: 'JSON API',       description: 'Fetch live JSON data from any REST endpoint' },
  { id: 'rss',            label: 'RSS Feed',        description: 'Parse RSS / Atom feeds for news & updates' },
  { id: 'csv',            label: 'CSV',             description: 'Import tabular data from a CSV URL' },
  { id: 'google_sheets',  label: 'Google Sheets',   description: 'Pull rows from a published Google Sheet' },
];

const REFRESH_OPTIONS = [
  { value: 60,    label: '1 minute' },
  { value: 300,   label: '5 minutes' },
  { value: 900,   label: '15 minutes' },
  { value: 1800,  label: '30 minutes' },
  { value: 3600,  label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '24 hours' },
];

export default function DatasyncModal({ workspaceId: _workspaceId, onClose }: Props) {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('json_api');
  const [sourceUrl, setSourceUrl] = useState('');
  const [refresh, setRefresh] = useState(300);

  const canSave = name.trim().length > 0 && sourceUrl.trim().length > 0;

  const handleSave = () => {
    toast.info('Datasync backend coming soon — your configuration will be saved when available.');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-md">

        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime-500/15">
              <Database size={18} className="text-lime-400" />
            </div>
            <div>
              <h2 className="modal-title">New Datasync</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Pull live data into your content from external sources</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-5">

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-xs text-amber-300 font-medium">Coming soon</p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              Datasync is under active development. You can configure your connection now and it will be activated when the backend is ready.
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product Prices Feed"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Data Source Type</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SOURCE_TYPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSourceType(s.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    sourceType === s.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'
                  }`}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{s.label}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{s.description}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Source URL</span>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://api.example.com/data.json"
              type="url"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Refresh Interval</span>
            <select
              value={refresh}
              onChange={(e) => setRefresh(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            >
              {REFRESH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Save Datasync
          </button>
        </div>

      </div>
    </div>
  );
}
