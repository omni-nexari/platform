import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save, Scan } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ActionButton, Callout } from '../../components/UiPrimitives.js';

export default function LiveLinkFaceEditorPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('Reception Avatar');
  const [udpPort, setUdpPort] = useState(11111);
  const [avatarPreset, setAvatarPreset] = useState<'face' | 'emoji' | 'minimal'>('face');
  const [sourceIp, setSourceIp] = useState('');

  const canSave = !!name.trim() && udpPort >= 1 && udpPort <= 65535;

  const saveMut = useMutation({
    mutationFn: () =>
      api.post('/content/live-link-face', {
        workspaceId: wsId,
        name: name.trim(),
        udpPort,
        avatarPreset,
        ...(sourceIp.trim() ? { sourceIp: sourceIp.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Live Link Face content created');
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
      navigate(`/workspaces/${wsId}/content`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  });

  if (!wsId) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/content`)}
            className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)]"
          >
            <ArrowLeft size={16} />
          </button>
          <Scan size={16} className="text-pink-400 shrink-0" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm font-semibold bg-transparent border-none outline-none text-[var(--text)] w-64"
            placeholder="Content name"
          />
        </div>
        <ActionButton
          onClick={() => saveMut.mutate()}
          disabled={!canSave || saveMut.isPending}
          className="px-4"
        >
          <Save size={14} />
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </ActionButton>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[var(--surface)]">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

          <Callout tone="accent">
            Streams real-time face data from the <strong>Epic Live Link Face</strong> iOS app over UDP.
            The TV receives ARKit blendshape data and animates an avatar on screen.
          </Callout>

          {/* Avatar Preset */}
          <div>
            <label className="block text-sm font-semibold text-[var(--text)] mb-2">Avatar Preset</label>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  { id: 'face',    label: 'Face',    desc: 'CSS SVG — eyes, mouth, brows' },
                  { id: 'emoji',   label: 'Emoji',   desc: 'Expression-mapped emoji' },
                  { id: 'minimal', label: 'Minimal', desc: 'Blendshape debug bars' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAvatarPreset(opt.id)}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    avatarPreset === opt.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/60'
                  }`}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{opt.label}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* UDP Port */}
          <div>
            <label className="block text-sm font-semibold text-[var(--text)] mb-1">UDP Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={udpPort}
              onChange={(e) => setUdpPort(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              In the iOS app: <strong>Settings → Target → Port</strong>. Default is 11111.
            </p>
          </div>

          {/* Source IP */}
          <div>
            <label className="block text-sm font-semibold text-[var(--text)] mb-1">
              iOS Device IP{' '}
              <span className="text-[var(--text-muted)] font-normal">(optional, for reference)</span>
            </label>
            <input
              type="text"
              value={sourceIp}
              onChange={(e) => setSourceIp(e.target.value)}
              placeholder="e.g. 192.168.1.42"
              className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Set the TV's IP as the <strong>Target IP</strong> in the Live Link Face iOS app.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
