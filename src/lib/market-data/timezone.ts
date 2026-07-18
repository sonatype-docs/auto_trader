// Timezone engine — pure. Uses Intl API, safe on server + client.
import { TZ_IANA, type Timezone } from "./types";

interface LocalParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekday: number; // 0=Sun..6=Sat
}

const FORMATTERS = new Map<Timezone, Intl.DateTimeFormat>();

function fmt(tz: Timezone): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ_IANA[tz],
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Break a UTC-ms timestamp into local parts in the given IANA timezone. */
export function toLocal(ts: number, tz: Timezone): LocalParts {
  const parts = fmt(tz).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
  };
}

export function formatIsoLocal(ts: number, tz: Timezone): string {
  const p = toLocal(ts, tz);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function localDateKey(ts: number, tz: Timezone): string {
  const p = toLocal(ts, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO 8601 week number in the given timezone. */
export function isoWeekNumber(ts: number, tz: Timezone): number {
  const p = toLocal(ts, tz);
  // Use UTC for the arithmetic against local Y/M/D to avoid host TZ drift.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function quarterOf(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}
