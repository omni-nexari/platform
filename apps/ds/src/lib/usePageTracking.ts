/**
 * usePageTracking — fires a `page_view` activity event on every route change
 * when inside a workspace context. Fire-and-forget; errors are silently discarded.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { api } from './api.js';

export function usePageTracking(workspaceId: string | null) {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;

    // Extract a clean page name from the path for the event data.
    const segment = pathname.replace(`/workspaces/${workspaceId}`, '').replace(/^\//, '') || 'dashboard';
    const page = segment.split('/')[0] || 'dashboard';

    api.post('/ai/activity', {
      workspaceId,
      eventType: 'page_view',
      eventData: { path: pathname, page },
    }).catch(() => {
      // Silently discard — tracking must never break navigation.
    });
  }, [pathname, workspaceId]);
}
