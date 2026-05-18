import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Tv2, Trash2 } from 'lucide-react';
import { api, buildApiUrl } from '../../lib/api.js';
import { PageHeader, Skeleton, EmptyState } from '../../components/UiPrimitives.js';
import CreateMenuBoardModal from '../../components/CreateMenuBoardModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import ContentDetailPanel from '../../components/ContentDetailPanel.js';

interface MenuBoardItem {
  id: string;
  name: string;
  type: string;
  thumbnailUrl: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PosMenuCard {
  name: string;
  currency: string;
  categories: {
    id: string;
    name: string;
    color: string | null;
    items: { id: string; name: string; priceCents: number; imageUrl: string | null }[];
  }[];
}

function MenuBoardCardPreview({ metadata }: { metadata: string | null }) {
  const meta = (() => { try { return JSON.parse(metadata ?? '{}'); } catch { return {}; } })();
  const posWorkspaceId = meta.posWorkspaceId as string | undefined;
  const layout         = (meta.layout as string) ?? '2-col';
  const showPrices     = (meta.showPrices as boolean) ?? true;
  const showImages     = (meta.showImages as boolean) ?? true;

  const { data: menu, isLoading } = useQuery<PosMenuCard>({
    queryKey: ['pos-menu-preview', posWorkspaceId],
    queryFn:  () => api.get(`/pos/menu?workspaceId=${posWorkspaceId}`),
    enabled:  !!posWorkspaceId,
    staleTime: 60_000,
  });

  if (!posWorkspaceId || isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0f1117]">
        {isLoading
          ? <div className="w-4 h-4 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
          : <Tv2 size={24} className="text-rose-400/60" />}
      </div>
    );
  }
  if (!menu || menu.categories.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-[#0f1117]">
        <Tv2 size={20} className="text-rose-400/40" />
        <span className="text-[8px] text-slate-500">No active menu</span>
      </div>
    );
  }

  const allItems = menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, catName: c.name, catColor: c.color })));

  return (
    <div className="w-full h-full overflow-hidden bg-[#0f1117] flex flex-col" style={{ fontFamily: 'system-ui,sans-serif' }}>
      {/* mini header */}
      <div className="shrink-0 flex items-center justify-between px-1.5 py-0.5 bg-[#1a1e2e] border-b border-white/10">
        <span className="text-[7px] font-bold text-white truncate uppercase tracking-wide">{menu.name}</span>
        <span className="text-[6px] text-rose-400 uppercase font-semibold">{layout.replace('-',' ')}</span>
      </div>
      {/* content */}
      <div className={`flex-1 min-h-0 overflow-hidden p-0.5 ${
        layout === '2-col' ? 'columns-2 gap-0.5' : 'flex flex-col gap-0.5'
      }`}>
        {layout === 'featured' ? (
          <>
            {allItems[0] && (
              <div className="shrink-0 flex gap-1 mb-0.5 p-1 rounded bg-white/5 border border-white/10">
                {showImages && allItems[0].imageUrl && (
                  <img
                    src={allItems[0].imageUrl.startsWith('http') ? allItems[0].imageUrl : buildApiUrl(allItems[0].imageUrl)}
                    alt=""
                    className="w-7 h-7 object-cover rounded shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[7px] font-bold text-white truncate">{allItems[0].name}</p>
                  {showPrices && <p className="text-[6px] text-rose-300">${(allItems[0].priceCents/100).toFixed(2)}</p>}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-0.5">
              {allItems.slice(1, 7).map((it) => (
                <div key={it.id} className="px-1 py-0.5 rounded bg-white/3 border border-white/8">
                  <p className="text-[6px] text-slate-200 truncate">{it.name}</p>
                  {showPrices && <p className="text-[6px] text-rose-300">${(it.priceCents/100).toFixed(2)}</p>}
                </div>
              ))}
            </div>
          </>
        ) : (
          menu.categories.map((cat) => (
            <div key={cat.id} className="break-inside-avoid mb-0.5">
              <div
                className="px-1 py-0.5 text-[6px] font-bold text-white uppercase tracking-wide rounded-t"
                style={{ background: cat.color ?? '#1e293b' }}
              >
                {cat.name}
              </div>
              <div className="border border-white/10 rounded-b overflow-hidden">
                {cat.items.slice(0, 6).map((it, idx) => (
                  <div key={it.id} className={`flex items-center gap-0.5 px-1 py-0.5 ${
                    idx % 2 === 0 ? 'bg-white/3' : ''
                  }`}>
                    {showImages && it.imageUrl && (
                      <img
                        src={it.imageUrl.startsWith('http') ? it.imageUrl : buildApiUrl(it.imageUrl)}
                        alt=""
                        className="w-3 h-3 object-cover rounded shrink-0"
                      />
                    )}
                    <span className="text-[6px] text-slate-200 flex-1 truncate">{it.name}</span>
                    {showPrices && (
                      <span className="text-[6px] text-rose-300 shrink-0">${(it.priceCents/100).toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface ContentResponse {
  items: MenuBoardItem[];
  total: number;
}

export default function PosMenuBoardsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');

  const { data, isLoading } = useQuery<ContentResponse>({
    queryKey: ['content', wsId, 'menu_board'],
    queryFn: () => api.get(`/content?workspaceId=${wsId}&type=menu_board&limit=200`),
    enabled: !!wsId,
  });

  const items = data?.items ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/content/${id}`),
    onSuccess: () => {
      toast.success('Menu board deleted');
      setConfirmDeleteId(null);
      setConfirmDeleteName('');
      void queryClient.invalidateQueries({ queryKey: ['content', wsId, 'menu_board'] });
    },
    onError: () => toast.error('Failed to delete menu board'),
  });

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        <PageHeader
          icon={<Tv2 size={22} />}
          title="Menu Boards"
          subtitle={`${items.length} board${items.length !== 1 ? 's' : ''}`}
          action={(
            <button onClick={() => setCreateOpen(true)} className="workspace-page-action">
              <Plus size={14} />
              New Menu Board
            </button>
          )}
        />

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Tv2 size={40} />}
            title="No menu boards yet"
            description="Create a menu board to display your POS menu as signage content."
            action={(
              <button onClick={() => setCreateOpen(true)} className="workspace-page-action">
                <Plus size={14} /> New Menu Board
              </button>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="ui-entity-card relative flex flex-col cursor-pointer group"
                onClick={() => setSelectedId(item.id)}
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-t-[0.95rem] bg-[#0f1117]">
                  <MenuBoardCardPreview metadata={item.metadata} />
                  <span className="ui-media-badge absolute top-2 left-2 z-20 bg-rose-500/80">
                    <Tv2 size={10} /> Menu Board
                  </span>
                </div>

                <div className="flex flex-col gap-1 px-3 py-2.5">
                  <p className="text-sm font-medium text-[var(--text)] truncate">{item.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Hover: quick delete */}
                <div className="absolute top-2 right-2 z-20 hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteName(item.name); setConfirmDeleteId(item.id); }}
                    className="p-1.5 rounded-lg bg-black/60 text-red-400 hover:bg-black/80 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen && wsId && (
        <CreateMenuBoardModal
          workspaceId={wsId}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['content', wsId, 'menu_board'] });
            setSelectedId(id);
          }}
        />
      )}

      {selectedId && wsId && (
        <ContentDetailPanel
          itemId={selectedId}
          workspaceId={wsId}
          skipPublishModeStep
          publishDeviceTypeFilter="menu-board"
          onClose={() => setSelectedId(null)}
          onDeleted={() => {
            setSelectedId(null);
            void queryClient.invalidateQueries({ queryKey: ['content', wsId, 'menu_board'] });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Menu Board"
        message={`Delete "${confirmDeleteName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => { if (confirmDeleteId) deleteMut.mutate(confirmDeleteId); }}
        onClose={() => { setConfirmDeleteId(null); setConfirmDeleteName(''); }}
      />
    </div>
  );
}
