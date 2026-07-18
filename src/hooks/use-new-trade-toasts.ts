import { useEffect, useRef } from "react";

type MinItem = Record<string, any>;

async function ensurePermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function notify(title: string, body: string, tag?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/favicon.ico" });
    // auto-close after 8s
    setTimeout(() => n.close(), 8000);
  } catch {
    // ignore
  }
}

/**
 * Fires a native browser Notification whenever a new item (by key) appears.
 * Seeds silently on first load and requests permission once.
 */
export function useNewTradeToasts<T extends MinItem>(
  items: T[] | undefined,
  label: string,
  opts?: { keyFn?: (t: T) => string; describe?: (t: T) => string },
) {
  const seenRef = useRef<Set<string> | null>(null);
  const keyFn = opts?.keyFn ?? ((t: T) => String(t.id));
  const describe =
    opts?.describe ??
    ((t: T) => {
      const side = String(t.side ?? t.direction ?? "").toUpperCase();
      const sym = t.symbol ?? "—";
      const px = t.entry_price != null ? ` @ ${t.entry_price}` : "";
      const qty = t.qty != null ? ` × ${t.qty}` : "";
      return `${side} ${sym}${qty}${px}`;
    });

  useEffect(() => {
    void ensurePermission();
  }, []);

  useEffect(() => {
    if (!items) return;
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map(keyFn));
      return;
    }
    const seen = seenRef.current;
    const fresh = items.filter((t) => !seen.has(keyFn(t)));
    if (!fresh.length) return;
    for (const t of fresh) {
      const k = keyFn(t);
      seen.add(k);
      notify(`${label} order placed`, describe(t), `${label}:${k}`);
    }
  }, [items, label, keyFn, describe]);
}
