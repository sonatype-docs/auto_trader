import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { queryTrades } from "@/lib/trade-intelligence.functions";
import type { TradeRecord } from "@/lib/trade-intelligence/types";

// Module-level cache keyed by dataset name. Survives route navigation within
// the SPA session. Partial rows are intentionally kept during Resync so a
// busy database can continue from the last loaded cursor instead of row 0.
const cache = new Map<string, TradeRecord[]>();
const partialCache = new Map<string, TradeRecord[]>();

const DB_NAME = "research-dataset-checkpoints";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";

type StoredChunk = { key: string; dataset: string; index: number; rows: TradeRecord[]; updatedAt: number };

function normaliseRows(rows: TradeRecord[]): TradeRecord[] {
  const seen = new Set<string>();
  const out: TradeRecord[] = [];
  for (const row of rows) {
    if (seen.has(row.tradeId)) continue;
    seen.add(row.tradeId);
    out.push(row);
  }
  return out.sort((a, b) => (a.entryTime - b.entryTime) || a.tradeId.localeCompare(b.tradeId));
}

function openCheckpointDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        store.createIndex("dataset", "dataset", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function loadPersistedRows(dataset: string): Promise<TradeRecord[]> {
  const db = await openCheckpointDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(CHUNK_STORE, "readonly");
    const index = tx.objectStore(CHUNK_STORE).index("dataset");
    const req = index.getAll(IDBKeyRange.only(dataset));
    req.onsuccess = () => {
      resolve(normaliseRows((req.result as StoredChunk[]).flatMap((c) => c.rows)));
      db.close();
    };
    req.onerror = () => { resolve([]); db.close(); };
  });
}

async function savePersistedChunk(dataset: string, index: number, rows: TradeRecord[]): Promise<void> {
  if (!rows.length) return;
  const db = await openCheckpointDb();
  if (!db) return;
  const first = rows[0];
  return new Promise((resolve) => {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    tx.objectStore(CHUNK_STORE).put({
      key: `${dataset}::${first.entryTime}::${first.tradeId}`,
      dataset,
      index,
      rows,
      updatedAt: Date.now(),
    } satisfies StoredChunk);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

async function clearPersistedRows(datasets?: string[]): Promise<void> {
  const db = await openCheckpointDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    const store = tx.objectStore(CHUNK_STORE);
    if (!datasets) {
      store.clear();
    } else {
      for (const dataset of datasets) {
        const req = store.index("dataset").openKeyCursor(IDBKeyRange.only(dataset));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          store.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

export function clearDatasetsCache(datasets?: string[], options: { keepPartial?: boolean } = {}) {
  if (!datasets) {
    cache.clear();
    if (!options.keepPartial) {
      partialCache.clear();
      void clearPersistedRows();
    }
  } else {
    for (const d of datasets) {
      cache.delete(d);
      if (!options.keepPartial) partialCache.delete(d);
    }
    if (!options.keepPartial) void clearPersistedRows(datasets);
  }
}

export interface DatasetProgress {
  loaded: number;
  done: boolean;
  cached?: boolean;
  status: "queued" | "fetching" | "retrying" | "cached" | "done" | "error";
  pageSize: number;
  rowsPerChunk: number;
  chunksPerWave: number;
  currentWave: number;
  wavesFetched: number;
  chunksFetched: number;
  lastBatchRows: number;
  startedAt?: number;
  updatedAt: number;
  error?: string;
}

export interface DatasetsProgressResult {
  data: Record<string, TradeRecord[]>;
  progress: Record<string, DatasetProgress>;
  isLoading: boolean;
  totalLoaded: number;
  error?: Error;
}

const PAGE = 4000;
const ROWS_PER_CHUNK = 4000;
const CHUNKS_PER_WAVE = 1;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function makeProgress(
  patch: Partial<DatasetProgress> & Pick<DatasetProgress, "loaded" | "done" | "status">,
): DatasetProgress {
  return {
    pageSize: PAGE,
    rowsPerChunk: ROWS_PER_CHUNK,
    chunksPerWave: CHUNKS_PER_WAVE,
    currentWave: 0,
    wavesFetched: 0,
    chunksFetched: 0,
    lastBatchRows: 0,
    updatedAt: Date.now(),
    ...patch,
  };
}

export function useDatasetsProgress(datasets: string[], resyncKey = 0): DatasetsProgressResult {
  const queryFn = useServerFn(queryTrades);
  const [data, setData] = useState<Record<string, TradeRecord[]>>({});
  const [progress, setProgress] = useState<Record<string, DatasetProgress>>({});
  const [error, setError] = useState<Error | undefined>();
  const key = datasets.join("|") + "::" + resyncKey;
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;
    let cancelled = false;
    setError(undefined);

    // Seed from memory immediately. IndexedDB checkpoints are loaded below
    // before network fetching starts, so reloads/crashes do not go back to 0.
    const seedData: Record<string, TradeRecord[]> = {};
    const seedProg: Record<string, DatasetProgress> = {};
    for (const ds of datasets) {
      if (cache.has(ds)) {
        const rows = cache.get(ds)!;
        seedData[ds] = rows;
        seedProg[ds] = makeProgress({
          loaded: rows.length,
          done: false,
          cached: true,
          status: "queued",
          wavesFetched: Math.ceil(rows.length / PAGE),
          chunksFetched: Math.ceil(rows.length / ROWS_PER_CHUNK),
          lastBatchRows: rows.length,
          error: `Resuming from memory checkpoint at row ${rows.length.toLocaleString()}.`,
        });
      } else {
        const partialRows = partialCache.get(ds) ?? [];
        if (partialRows.length) seedData[ds] = partialRows;
        seedProg[ds] = makeProgress({
          loaded: partialRows.length,
          done: false,
          cached: false,
          status: "queued",
          wavesFetched: Math.floor(partialRows.length / (ROWS_PER_CHUNK * CHUNKS_PER_WAVE)),
          chunksFetched: Math.floor(partialRows.length / ROWS_PER_CHUNK),
          lastBatchRows: 0,
        });
      }
    }
    setData(seedData);
    setProgress(seedProg);

    (async () => {
      for (const ds of datasets) {
        if (cancelled || runRef.current !== runId) return;
        let acc: TradeRecord[] = normaliseRows((cache.get(ds) ?? partialCache.get(ds) ?? []).slice());
        if (acc.length === 0) {
          const persisted = await loadPersistedRows(ds);
          if (cancelled || runRef.current !== runId) return;
          if (persisted.length) {
            acc = persisted;
            partialCache.set(ds, persisted);
            setData((d) => ({ ...d, [ds]: persisted }));
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: persisted.length, done: false, status: "queued" })),
                loaded: persisted.length,
                done: false,
                cached: false,
                status: "queued",
                wavesFetched: Math.floor(persisted.length / PAGE),
                chunksFetched: Math.floor(persisted.length / ROWS_PER_CHUNK),
                updatedAt: Date.now(),
                error: `Resuming from saved checkpoint at row ${persisted.length.toLocaleString()}.`,
              },
            }));
          }
        }
        const seen = new Set(acc.map((r) => r.tradeId));
        let wave = 0;
        let done = false;
        let pageSize = PAGE;
        const chunksPerWave = CHUNKS_PER_WAVE;
        let chunksFetched = Math.floor(acc.length / ROWS_PER_CHUNK);
        let retryCount = 0;
        const startedAt = Date.now();
        try {
          while (!done && !cancelled && runRef.current === runId) {
            wave += 1;
            const cursor = acc.at(-1);
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "queued" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                pageSize,
                rowsPerChunk: pageSize,
                chunksPerWave,
                currentWave: wave,
                startedAt,
                updatedAt: Date.now(),
              },
            }));
            const res = await queryFn({
              data: {
                limit: pageSize,
                orderBy: "entry_time",
                order: "asc",
                dataset: ds,
                projection: "research",
                cursorEntryTimeMs: cursor?.entryTime ?? 0,
                ...(cursor ? { cursorTradeId: cursor.tradeId } : {}),
              },
            }) as { rows: TradeRecord[]; transientError?: string; partial?: boolean; hasMore?: boolean };

            const rows = normaliseRows(res.rows ?? []);
            let waveLoaded = 0;
            for (const row of rows) {
              if (seen.has(row.tradeId)) continue;
              seen.add(row.tradeId);
              waveLoaded += 1;
            }
            if (waveLoaded) {
              acc = normaliseRows([...acc, ...rows]);
              chunksFetched += 1;
              await savePersistedChunk(ds, chunksFetched, rows);
              partialCache.set(ds, acc.slice());
              setData((d) => ({ ...d, [ds]: acc.slice() }));
            }

            if (!rows.length && !res.transientError) {
              done = true;
              continue;
            }

            if (res.transientError) {
              retryCount = waveLoaded ? 0 : retryCount + 1;
              const firstError = new Error(res.transientError);
              setError(firstError);
              pageSize = Math.max(250, Math.floor(pageSize / 2));
              const delayMs = waveLoaded ? 750 : Math.min(30_000, 1500 * retryCount);
              setProgress((p) => ({
                ...p,
                [ds]: {
                  ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "retrying" })),
                  loaded: acc.length,
                  done: false,
                  cached: false,
                  status: "retrying",
                  pageSize,
                  rowsPerChunk: pageSize,
                  chunksPerWave,
                  currentWave: wave,
                  wavesFetched: Math.max(0, wave - 1),
                  chunksFetched,
                  lastBatchRows: waveLoaded,
                  startedAt,
                  updatedAt: Date.now(),
                  error: `${firstError.message} ${waveLoaded ? "Saved this partial page; " : ""}Retrying from row ${acc.length.toLocaleString()} in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
                },
              }));
              await wait(delayMs);
              continue;
            }

            if (!waveLoaded && rows.length) {
              chunksFetched += 1;
              await savePersistedChunk(ds, chunksFetched, rows);
            }
            partialCache.set(ds, acc.slice());
            setData((d) => ({ ...d, [ds]: acc.slice() }));
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "fetching" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                pageSize,
                rowsPerChunk: pageSize,
                chunksPerWave,
                currentWave: wave,
                wavesFetched: wave,
                chunksFetched,
                lastBatchRows: waveLoaded,
                startedAt,
                updatedAt: Date.now(),
                error: undefined,
              },
            }));

            retryCount = 0;
            setError(undefined);
            if (pageSize < PAGE) pageSize = Math.min(PAGE, pageSize * 2);
            if (res.hasMore === false) {
              done = true;
            }
          }
          if (cancelled || runRef.current !== runId) return;
          cache.set(ds, acc);
          partialCache.delete(ds);
          setData((d) => ({ ...d, [ds]: acc }));
          setProgress((p) => ({
            ...p,
            [ds]: {
              ...(p[ds] ?? makeProgress({ loaded: acc.length, done: true, status: "done" })),
              loaded: acc.length,
              done: true,
              cached: false,
              status: "done",
              updatedAt: Date.now(),
            },
          }));
        } catch (e) {
          if (!cancelled && runRef.current === runId) {
            const err = e as Error;
            setError(err);
            partialCache.set(ds, acc.slice());
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "error" })),
                loaded: acc.length,
                done: false,
                status: "error",
                error: `${err.message} Resume will continue from row ${acc.length.toLocaleString()}.`,
                updatedAt: Date.now(),
              },
            }));
          }
          return;
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isLoading = datasets.some((ds) => !progress[ds]?.done);
  const totalLoaded = datasets.reduce((sum, ds) => sum + (progress[ds]?.loaded ?? 0), 0);
  return { data, progress, isLoading, totalLoaded, error };
}
