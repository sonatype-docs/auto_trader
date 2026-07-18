// Shared "current dataset" selection across Trade Intelligence + Research.
// Persists to localStorage so both routes stay in sync across navigations
// and tabs. "live" = trade_intelligence table; anything else = archived
// snapshot label in trade_intelligence_archive.
import { useEffect, useState } from "react";

const STORAGE_KEY = "ti-dataset";
const EVENT = "ti-dataset-changed";

function read(): string {
  if (typeof window === "undefined") return "live";
  try { return window.localStorage.getItem(STORAGE_KEY) || "live"; }
  catch { return "live"; }
}

export function useDataset(): [string, (v: string) => void] {
  // Always initialize to "live" for SSR-safe hydration. Read persisted value
  // in an effect so the first client render matches the server output.
  const [value, setValue] = useState<string>("live");

  useEffect(() => {
    setValue(read());
    const sync = () => setValue(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);


  const update = (v: string) => {
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch { /* quota */ }
    setValue(v);
    window.dispatchEvent(new Event(EVENT));
  };

  return [value, update];
}
