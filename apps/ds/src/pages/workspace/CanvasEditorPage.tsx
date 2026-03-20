import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useCanvasStore } from '../../lib/canvasStore.js';
import type { CanvasProject } from '../../lib/canvasTypes.js';
import CanvasTopMenu from '../../components/canvas/CanvasTopMenu.js';
import CanvasSidebar from '../../components/canvas/CanvasSidebar.js';
import CanvasStage from '../../components/canvas/CanvasStage.js';
import CanvasPropertyPanel from '../../components/canvas/CanvasPropertyPanel.js';
import CanvasPageBar from '../../components/canvas/CanvasPageBar.js';
import { useCanvasShortcuts } from '../../components/canvas/useCanvasShortcuts.js';
import { useAutoSave } from '../../components/canvas/useAutoSave.js';
import { Skeleton } from '../../components/UiPrimitives.js';

export default function CanvasEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const loadProject = useCanvasStore((s) => s.loadProject);
  const resetProject = useCanvasStore((s) => s.resetProject);

  // Load project from API
  const { data: project, isLoading, error } = useQuery<CanvasProject>({
    queryKey: ['canvas', id],
    queryFn: () => api.get(`/canvas/${id}`),
    enabled: !!id && id !== 'new',
  });

  // Load project into store once fetched
  useEffect(() => {
    if (project) {
      loadProject(project);
    }
  }, [project, loadProject]);

  // Reset store on unmount
  useEffect(() => {
    return () => resetProject();
  }, [resetProject]);

  // Keyboard shortcuts
  useCanvasShortcuts();

  // Auto-save
  useAutoSave();

  // New project creation flow
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (id === 'new' && wsId && !creating) {
      setCreating(true);
      api.post<CanvasProject>('/canvas', {
        workspaceId: wsId,
        name: 'Untitled Design',
      }).then((created) => {
        // Replace URL without adding to history
        navigate(`/workspaces/${wsId}/canvas/${created.id}`, { replace: true });
        loadProject(created);
      }).catch(() => {
        toast.error('Could not create a new design');
        navigate(`/workspaces/${wsId}/content`);
      });
    }
  }, [id, wsId, creating, navigate, loadProject]);

  // Loading state
  if (id === 'new' || isLoading) {
    return (
      <div className="flex h-full flex-col bg-[var(--surface)] p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3 border-b border-[var(--border)] pb-4">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
          <Skeleton className="h-full min-h-[18rem] rounded-2xl" />
          <Skeleton className="h-full min-h-[18rem] rounded-2xl" />
          <Skeleton className="h-full min-h-[18rem] rounded-2xl" />
        </div>
        <Skeleton className="mt-4 h-12 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-2">Could not load this design</p>
          <button
            onClick={() => navigate(`/workspaces/${wsId}/content`)}
            className="text-xs text-[var(--blue)] hover:underline"
          >
            Back to Content
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top menu */}
      <div className="flex items-center h-11 shrink-0 border-b border-[var(--border)] bg-[var(--card)]">
        {/* Back button */}
        <button
          onClick={() => navigate(`/workspaces/${wsId}/content`)}
          className="flex items-center gap-1.5 px-3 h-full text-xs text-[var(--text-muted)] hover:text-[var(--text)] border-r border-[var(--border)] transition-colors"
          title="Back to Content"
        >
          <ArrowLeft size={14} />
          Content
        </button>
        <div className="flex-1">
          <CanvasTopMenu />
        </div>
      </div>

      {/* Main area: sidebar + stage + property panel */}
      <div className="flex flex-1 min-h-0">
        <CanvasSidebar />
        <CanvasStage />
        <CanvasPropertyPanel />
      </div>

      {/* Bottom bar: pages + zoom */}
      <CanvasPageBar />
    </div>
  );
}
