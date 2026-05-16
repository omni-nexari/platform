/**
 * Template wizard — pick a starter template, name it, then edit its HTML/CSS/JS.
 * Steps:  1. Template   2. Name   3. Edit
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, FileCode2, Library } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ActionButton, Badge, Callout, SectionCard, SectionCardBody, SectionCardHeader, Skeleton } from '../../components/UiPrimitives.js';
import Html5EditorModal from '../../components/Html5EditorModal.js';

interface Template {
  id: string;
  name: string;
  description: string;
}

export default function TemplateEditorPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [tplId, setTplId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const stepNames = ['Template', 'Name', 'Edit'];
  const totalSteps = stepNames.length;

  // ── Queries ───────────────────────────────────────────────────────────────
  const tplListQ = useQuery<{ templates: Template[] }>({
    queryKey: ['html5-templates'],
    queryFn: () => api.get('/content/html5/templates'),
    staleTime: 60_000,
  });

  const selectedTemplate = tplListQ.data?.templates.find((t) => t.id === tplId) ?? null;

  // ── Mutation ──────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: () =>
      api.post('/content/html5/create', {
        workspaceId: wsId,
        templateId: tplId,
        name: name.trim(),
      }),
    onSuccess: (created: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
      const cid = (created as { id?: string })?.id ?? null;
      setCreatedId(cid);
      setStep(2);
      toast.success('HTML5 content created — edit your files below');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Create failed'),
    onSettled: () => setCreating(false),
  });

  const canNext = step === 0 ? !!tplId : true;
  const canCreate = !!tplId && name.trim().length > 0;

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
          <span className="text-base font-semibold text-[var(--text)]">
            {name || selectedTemplate?.name || 'New from Template'}
          </span>
          <Badge tone="accent">HTML5</Badge>
        </div>

        <div className="flex items-center gap-2">
          {stepNames.map((n, i) => (
            <button
              key={n}
              onClick={() => { if (i < 2 && !createdId) setStep(i); }}
              disabled={i === 2 && !createdId}
              className={`px-2 py-1 rounded text-xs ${i === step ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)] disabled:opacity-40 disabled:cursor-default'}`}
            >
              {i + 1}. {n}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {step > 0 && step < 2 && <ActionButton onClick={() => setStep((s) => s - 1)}>Back</ActionButton>}
          {step === 0 && (
            <ActionButton onClick={() => setStep(1)} disabled={!canNext}>
              Next <ArrowRight size={14} />
            </ActionButton>
          )}
          {step === 1 && (
            <ActionButton
              onClick={() => { setCreating(true); saveMut.mutate(); }}
              disabled={creating || !canCreate}
            >
              {creating ? 'Creating…' : 'Create & Edit'}
            </ActionButton>
          )}
          {step === 2 && (
            <ActionButton onClick={() => navigate(`/workspaces/${wsId}/content${createdId ? `?openId=${createdId}` : ''}`)}>
              <Library size={14} /> Go to Library
            </ActionButton>
          )}
        </div>
      </header>

      {/* Body */}
      {step < 2 ? (
        <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
          <div className="max-w-3xl mx-auto p-6 space-y-6">

          {/* ── Step 0: Template ── */}
          {step === 0 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><FileCode2 size={14} className="inline mr-1.5 mb-0.5" />Choose a Template</h3>
              </SectionCardHeader>
              <SectionCardBody>
                {tplListQ.isLoading && (
                  <div className="space-y-2">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                )}
                {tplListQ.isError && (
                  <Callout tone="danger">Failed to load templates. Please try again.</Callout>
                )}
                {tplListQ.data?.templates.length === 0 && (
                  <Callout tone="warning">No templates available yet.</Callout>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {tplListQ.data?.templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTplId(t.id)}
                      className={`flex items-start gap-3 text-left p-4 rounded-lg border transition-colors ${
                        tplId === t.id
                          ? 'border-[var(--blue)] bg-[var(--blue)]/10'
                          : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'
                      }`}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {tplId === t.id ? (
                          <div className="w-5 h-5 rounded-full bg-[var(--blue)] flex items-center justify-center">
                            <Check size={12} className="text-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-[var(--border)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--text)]">{t.name}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{t.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* ── Step 1: Name ── */}
          {step === 1 && (
            <>
              <SectionCard>
                <SectionCardHeader>
                  <h3 className="text-sm font-semibold">Name Your Content</h3>
                </SectionCardHeader>
                <SectionCardBody className="space-y-4">
                  {selectedTemplate && (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--blue)] bg-[var(--blue)]/10">
                      <FileCode2 size={16} className="text-[var(--blue)] flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">{selectedTemplate.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{selectedTemplate.description}</p>
                      </div>
                    </div>
                  )}

                  <label className="block">
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Content Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={selectedTemplate?.name ?? 'My HTML5 Banner'}
                      autoFocus
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </label>

                  <p className="text-xs text-[var(--text-muted)]">
                    Click <strong>Create &amp; Edit</strong> to create the content and open the code editor.
                    You can modify the HTML, CSS, and JS before publishing.
                  </p>
                </SectionCardBody>
              </SectionCard>
            </>
          )}

          </div>
        </div>
      ) : (
        /* ── Step 2: Embedded HTML5 editor ── */
        createdId ? (
          <Html5EditorModal
            contentId={createdId}
            contentName={name}
            onClose={() => navigate(`/workspaces/${wsId}/content?openId=${createdId}`)}
            embedded
          />
        ) : null
      )}
    </div>
  );
}
