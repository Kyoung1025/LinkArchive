import { useCallback, useEffect, useState } from 'react';
import { fetchTags } from '../api/client';
import type { Tag } from '../api/types';

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);

  const refresh = useCallback(async () => {
    const data = await fetchTags();
    setTags(data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tags, refresh };
}
