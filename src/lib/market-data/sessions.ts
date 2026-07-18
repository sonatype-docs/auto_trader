// Session engine — classify every bar into a market session.
// All session windows are expressed in UTC and derived from the standard
// FX/metals session boundaries. If the user defines custom sessions, those
// are checked against the strategy timezone independently.

import { toLocal } from "./timezone";
import type { CustomSession, SessionName, Timezone } from "./types";

interface Window { name: SessionName; startH: number; endH: number }

// UTC window definitions (approximate, ignoring DST for classification).
const WINDOWS: Window[] = [
  { name: "sydney",   startH: 21, endH: 30 }, // 21:00..06:00 next day
  { name: "asian",    startH: 0,  endH: 9 },
  { name: "london",   startH: 7,  endH: 16 },
  { name: "new_york", startH: 12, endH: 21 },
];

export function classifySession(tsUtcMs: number): SessionName {
  const utc = toLocal(tsUtcMs, "UTC");
  const h = utc.hour + utc.minute / 60;
  const inLondon = h >= 7 && h < 16;
  const inNY = h >= 12 && h < 21;
  if (inLondon && inNY) return "london_ny_overlap";
  if (inLondon) return "london";
  if (inNY) return "new_york";
  for (const w of WINDOWS) {
    if (w.name === "london" || w.name === "new_york") continue;
    const end = w.endH % 24;
    if (w.endH > 24) {
      if (h >= w.startH || h < end) return w.name;
    } else if (h >= w.startH && h < w.endH) {
      return w.name;
    }
  }
  return "off";
}

export function activeCustomSessions(
  tsUtcMs: number,
  strategyTz: Timezone,
  sessions: CustomSession[],
): string[] {
  if (!sessions.length) return [];
  const p = toLocal(tsUtcMs, strategyTz);
  const t = p.hour * 60 + p.minute;
  const out: string[] = [];
  for (const s of sessions) {
    const start = s.startHour * 60 + s.startMinute;
    const end = s.endHour * 60 + s.endMinute;
    const active = end > start ? t >= start && t < end : t >= start || t < end;
    if (active) out.push(s.name);
  }
  return out;
}
