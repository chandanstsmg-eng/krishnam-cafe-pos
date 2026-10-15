import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { onServerChange } from '../services/events';

/** Refetches the given queries whenever the server reports a change to any of `topics`. */
export function useLive(topics: string[], keys: QueryKey[]) {
  const qc = useQueryClient();
  const sig = JSON.stringify([topics, keys]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return onServerChange((changed) => {
      if (!changed.some((c) => topics.includes(c))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })), 200);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, qc]);
}
