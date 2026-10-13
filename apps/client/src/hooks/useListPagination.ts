import { useCallback, useEffect, useRef, useState } from "react";

export const LIST_PAGE_SIZE = 20;

/** Paginate the complete, already-filtered list; disappearing last pages clamp immediately. */
export function useArrayPagination<T>(allItems: readonly T[], pageSize = LIST_PAGE_SIZE) {
  const [requestedPage, setRequestedPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  useEffect(() => { if (page !== requestedPage) setRequestedPage(page); }, [page, requestedPage]);
  const setPage = useCallback((next: number) => {
    if (Number.isInteger(next)) setRequestedPage(Math.max(1, Math.min(next, totalPages)));
  }, [totalPages]);
  const resetPage = useCallback(() => setRequestedPage(1), []);
  return {
    items: allItems.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
    total: allItems.length, totalPages, hasNext: page < totalPages, hasPrevious: page > 1,
    setPage, resetPage, nextPage: () => setPage(page + 1), previousPage: () => setPage(page - 1),
  };
}

export type ListPageRequest = { offset: number; limit: number; signal: AbortSignal };
export type ListPageResult<T> = { items: T[]; hasMore: boolean };

/** Keep data and its page together. A failed request never relabels the previous page. */
export function useRemotePagination<T>(load: (request: ListPageRequest) => Promise<ListPageResult<T>>, fallbackError: string, pageSize = LIST_PAGE_SIZE) {
  const [snapshot, setSnapshot] = useState<{ items: T[]; page: number; hasMore: boolean }>({ items: [], page: 1, hasMore: false });
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const version = useRef(0), mounted = useRef(true), requestedPage = useRef(1);
  const active = useRef<{ target: number; controller: AbortController; promise: Promise<void> } | null>(null);
  const loadPage = useCallback((target: number, force = false): Promise<void> => {
    if (!mounted.current || !Number.isInteger(target) || target < 1) return Promise.resolve();
    if (!force && active.current?.target === target) return active.current.promise;
    const current = ++version.current;
    active.current?.controller.abort();
    const controller = new AbortController();
    requestedPage.current = target;
    setLoading(true); setError(null);
    const promise = Promise.resolve().then(async () => {
      try {
        let page = target;
        while (true) {
          requestedPage.current = page;
          const result = await load({ offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal });
          if (!mounted.current || current !== version.current) return;
          // Deletions can empty the current last page; read the previous real page.
          if (!result.items.length && page > 1) { page--; continue; }
          setSnapshot({ items: result.items, hasMore: result.hasMore, page });
          break;
        }
      } catch (error) {
        if (mounted.current && current === version.current && !controller.signal.aborted)
          setError(error instanceof Error ? error.message : fallbackError);
      } finally {
        if (mounted.current && current === version.current) { active.current = null; setLoading(false); }
      }
    });
    active.current = { target, controller, promise };
    return promise;
  }, [load, fallbackError, pageSize]);
  const refresh = useCallback(() => loadPage(requestedPage.current, true), [loadPage]);
  const setPage = useCallback((page: number) => { void loadPage(page); }, [loadPage]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; version.current++; active.current?.controller.abort(); active.current = null; };
  }, [refresh]);
  return { items: snapshot.items, page: snapshot.page, pageSize, hasNext: snapshot.hasMore, hasPrevious: snapshot.page > 1, loading, error, refresh, setPage };
}
