import { useState } from 'react';
import { toast } from 'sonner';
import { X, Link2 } from 'lucide-react';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type ConnectionType = 'websocket' | 'mqtt' | 'webhook';

const CONNECTION_TYPES: { id: ConnectionType; label: string; description: string; placeholder: string }[] = [
  {
    id: 'websocket',
    label: 'WebSocket',
    description: 'Receive real-time push updates over a persistent WS connection',
    placeholder: 'wss://realtime.example.com/feed',
  },
  {
    id: 'mqtt',
    label: 'MQTT',
    description: 'Subscribe to topics on an MQTT broker for IoT & sensor data',
    placeholder: 'mqtt://broker.example.com:1883',
  },
  {
    id: 'webhook',
    label: 'Webhook',
    description: 'Receive incoming HTTP POST payloads from external services',
    placeholder: 'https://platform.example.com/webhook/my-hook',
  },
];

export default function DatalinkModal({ workspaceId: _workspaceId, onClose }: Props) {
  const [name, setName] = useState('');
  const [connType, setConnType] = useState<ConnectionType>('websocket');
  const [endpoint, setEndpoint] = useState('');
  const [topic, setTopic] = useState('');

  const selected = CONNECTION_TYPES.find((c) => c.id === connType)!;
  const canSave = name.trim().length > 0 && endpoint.trim().length > 0;

  const handleSave = () => {
    toast.info('Datalink backend coming soon — your connection will be activated when available.');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-md">

        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
              <Link2 size={18} className="text-amber-400" />
            </div>
            <div>
              <h2 className="modal-title">New Datalink</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Connect a real-time data stream to your content</p>
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
              Datalink is under active development. Configure your connection now and it will be activated when the backend is ready.
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Store Sensor Feed"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Connection Type</span>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {CONNECTION_TYPES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConnType(c.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    connType === c.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'
                  }`}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{c.label}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{c.description}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              {connType === 'webhook' ? 'Webhook URL' : connType === 'mqtt' ? 'Broker URL' : 'WebSocket URL'}
            </span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={selected.placeholder}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono"
            />
          </label>

          {connType === 'mqtt' && (
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Topic</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="store/sensor/#"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono"
              />
            </label>
          )}

          {connType === 'websocket' && (
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Path / Channel</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="/live/prices"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono"
              />
            </label>
          )}

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
            Save Datalink
          </button>
        </div>

      </div>
    </div>
  );
}
