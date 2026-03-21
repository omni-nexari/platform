import { useEffect, useState } from 'react';
import { buildApiUrl } from '../lib/api.js';

interface Props {
  /** Content item ID — used to build the /thumbnail URL */
  itemId: string;
  alt?: string;
  className?: string;
  /** Called if the fetch fails. status=0 means network error. */
  onError?: (status: number) => void;
  /** Increment this to force a re-fetch (e.g. after regeneration). */
  revision?: number;
}

/**
 * Fetches `/content/:itemId/thumbnail` with the Bearer token, converts
 * the response to a blob URL, and renders an <img>.  The blob URL is revoked
 * on unmount to avoid memory leaks.
 */
export default function AuthImg({ itemId, alt = '', className, onError, revision = 0 }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    let blobUrl: string | null = null;
    let cancelled = false;
    setSrc(null); // reset while re-fetching

    fetch(buildApiUrl(`/content/${itemId}/thumbnail`), {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) onError?.(res.status);
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          blobUrl = URL.createObjectURL(blob);
          setSrc(blobUrl);
        }
      })
      .catch(() => {
        if (!cancelled) onError?.(0);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [itemId, revision]);

  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
