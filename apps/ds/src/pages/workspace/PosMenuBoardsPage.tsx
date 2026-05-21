import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Tv2, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Skeleton, EmptyState } from '../../components/UiPrimitives.js';
import CreateMenuBoardModal from '../../components/CreateMenuBoardModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import ContentDetailPanel from '../../components/ContentDetailPanel.js';
import MenuBoardCanvas, { type MenuBoardCanvasMenu } from '../../components/menu-board/MenuBoardCanvas.js';
import { parseMenuBoardMetadata } from '../../components/menu-board/menuBoardConfig.js';

interface MenuBoardItem {
  id: string;
  name: string;
  type: string;
  thumbnailUrl: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

function MenuBoardCardPreview({ metadata }: { metadata: string | null }) {
  const config = parseMenuBoardMetadata(metadata);
  const posWorkspaceId = config.posWorkspaceId || undefined;

  const { data: menu, isLoading } = useQuery<MenuBoardCanvasMenu>({
    queryKey: ['pos-menu-preview', posWorkspaceId],
    queryFn:  () => api.get(`/pos/menu?workspaceId=${posWorkspaceId}`),
    enabled:  !!posWorkspaceId,
    staleTime: 60_000,
  });

  if (!posWorkspaceId || isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: config.backgroundColor }}>
        {isLoading
          ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: config.accentColor }} />
          : <Tv2 size={24} style={{ color: config.accentColor, opacity: 0.6 }} />}
      </div>
    );
  }

  return <MenuBoardCanvas config={config} menu={menu ?? null} density="xs" />;
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
          publishExcludeSignage
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
