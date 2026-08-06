import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLinks } from '../api/client';
import type { Link, LinksQuery } from '../api/types';

const POLL_INTERVAL_MS = 3000;

export function useLinks(query: LinksQuery) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await fetchLinks(query);
      if (requestId !== requestIdRef.current) return; // a newer request has since been issued
      setLinks(data);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load links');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.status, query.tag, query.search]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasInFlight = links.some((link) => link.status === 'pending' || link.status === 'processing');
    if (!hasInFlight) return;
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [links, refresh]);

  return { links, loading, error, refresh };
}
