import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { RowData } from "@/types/table";
import type { FilterCondition, FilterLogic } from "@table/shared";
import { DEFAULT_PAGE_SIZE, isFilterConditionComplete } from "@table/shared";

type Sort = { columnId: string; direction: "asc" | "desc" } | null;

type Options = {
  tableId: string;
  filters: FilterCondition[];
  filterLogic: FilterLogic;
  sort: Sort;
  pageSize?: number;
};

/**
 * Sparse row cache backed by keyset windows.
 * Indices 0..totalMatched-1 map to rows as pages are fetched.
 */
export function useWindowedRows({
  tableId,
  filters,
  filterLogic,
  sort,
  pageSize = DEFAULT_PAGE_SIZE,
}: Options) {
  const [totalMatched, setTotalMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef<(RowData | undefined)[]>([]);
  const [, bump] = useState(0);
  const force = () => bump((n) => n + 1);

  // page starts keyed by start index
  const loadedPages = useRef(new Set<number>());
  const inFlight = useRef(new Set<number>());
  const queryKey = useRef("");
  const cursorsByPage = useRef<Map<number, string | null>>(new Map([[0, null]]));

  const resetAndLoadFirst = useCallback(async () => {
    const activeFilters = filters.filter(isFilterConditionComplete);
    const key = JSON.stringify({ tableId, filters: activeFilters, filterLogic, sort, pageSize });
    queryKey.current = key;
    loadedPages.current = new Set();
    inFlight.current = new Set();
    cursorsByPage.current = new Map([[0, null]]);
    rowsRef.current = [];
    setLoading(true);
    setError(null);
    try {
      const page = await api.queryRowsPage(tableId, {
        cursor: null,
        limit: pageSize,
        includeTotal: true,
        filters: activeFilters,
        filterLogic,
        sort,
      });
      if (queryKey.current !== key) return;
      const total = page.totalMatched ?? page.rows.length;
      setTotalMatched(total);
      rowsRef.current = new Array(total);
      for (let i = 0; i < page.rows.length; i++) {
        rowsRef.current[i] = page.rows[i];
      }
      loadedPages.current.add(0);
      if (page.nextCursor) {
        cursorsByPage.current.set(1, page.nextCursor);
      }
      force();
    } catch (e) {
      if (queryKey.current === key) {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    } finally {
      if (queryKey.current === key) setLoading(false);
    }
  }, [tableId, filters, filterLogic, sort, pageSize]);

  useEffect(() => {
    void resetAndLoadFirst();
  }, [resetAndLoadFirst]);

  /**
   * Ensure pages covering [start, end] are loaded.
   * Pages after 0 are fetched by walking cursors sequentially when needed.
   */
  const ensureRange = useCallback(
    async (start: number, end: number) => {
      const key = queryKey.current;
      const firstPage = Math.max(0, Math.floor(start / pageSize));
      const lastPage = Math.max(0, Math.floor(end / pageSize));

      for (let p = firstPage; p <= lastPage; p++) {
        if (loadedPages.current.has(p) || inFlight.current.has(p)) continue;

        // Need cursor for page p — if missing, fill preceding pages first
        if (!cursorsByPage.current.has(p) && p > 0) {
          // load earlier pages to discover cursor chain
          for (let q = 0; q < p; q++) {
            if (!loadedPages.current.has(q) && !inFlight.current.has(q)) {
              await fetchPage(q, key);
            }
          }
        }
        await fetchPage(p, key);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageSize]
  );

  async function fetchPage(pageIndex: number, key: string) {
    if (loadedPages.current.has(pageIndex) || inFlight.current.has(pageIndex)) return;
    if (!cursorsByPage.current.has(pageIndex)) return;
    const cursor = cursorsByPage.current.get(pageIndex) ?? null;
    inFlight.current.add(pageIndex);
    try {
      const activeFilters = filters.filter(isFilterConditionComplete);
      const page = await api.queryRowsPage(tableId, {
        cursor,
        limit: pageSize,
        includeTotal: false,
        filters: activeFilters,
        filterLogic,
        sort,
      });
      if (queryKey.current !== key) return;
      const base = pageIndex * pageSize;
      if (rowsRef.current.length < base + page.rows.length) {
        // grow if total was underestimated
        const next = rowsRef.current.slice();
        while (next.length < base + page.rows.length) next.push(undefined);
        rowsRef.current = next;
      }
      for (let i = 0; i < page.rows.length; i++) {
        rowsRef.current[base + i] = page.rows[i];
      }
      loadedPages.current.add(pageIndex);
      if (page.nextCursor) {
        cursorsByPage.current.set(pageIndex + 1, page.nextCursor);
      }
      force();
    } catch (e) {
      if (queryKey.current === key) {
        setError(e instanceof Error ? e.message : "分页加载失败");
      }
    } finally {
      inFlight.current.delete(pageIndex);
    }
  }

  const getRow = (index: number) => rowsRef.current[index];

  const upsertRow = (row: RowData) => {
    const idx = rowsRef.current.findIndex((r) => r?.id === row.id);
    if (idx >= 0) {
      rowsRef.current[idx] = row;
      force();
    }
  };

  const removeRow = (rowId: string) => {
    const idx = rowsRef.current.findIndex((r) => r?.id === rowId);
    if (idx >= 0) {
      rowsRef.current.splice(idx, 1);
      setTotalMatched((t) => Math.max(0, t - 1));
      force();
    }
  };

  const prependOrAppendRow = (row: RowData, atEnd = true) => {
    if (atEnd) {
      rowsRef.current.push(row);
    } else {
      rowsRef.current.unshift(row);
    }
    setTotalMatched((t) => t + 1);
    force();
  };

  return {
    totalMatched,
    loading,
    error,
    setError,
    getRow,
    ensureRange,
    upsertRow,
    removeRow,
    prependOrAppendRow,
    reload: resetAndLoadFirst,
    rowsSnapshot: () => rowsRef.current.filter(Boolean) as RowData[],
  };
}
