// Human-readable entry window schedule (IST) for each strategy preset.
// Session UTC bounds mirror src/lib/market-data/sessions.ts. IST = UTC + 5:30.

export type SessionKey =
  | "london"
  | "new_york"
  | "london_ny_overlap"
  | "asian"
  | "sydney";

interface UtcWindow { startH: number; endH: number } // endH may exceed 24 (wraps)

const UTC_WINDOWS: Record<SessionKey, UtcWindow> = {
  asian:             { startH: 0,  endH: 9 },
  london:            { startH: 7,  endH: 16 },
  london_ny_overlap: { startH: 12, endH: 16 },
  new_york:          { startH: 12, endH: 21 },
  sydney:            { startH: 21, endH: 30 }, // 21:00..06:00 next day
};

const IST_OFFSET_MIN = 5 * 60 + 30;

function pad(n: number) { return String(n).padStart(2, "0"); }

function fmtIstMinutes(m: number) {
  const mod = ((m % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mod / 60))}:${pad(mod % 60)}`;
}

export interface IstWindow {
  session: SessionKey;
  label: string;   // "12:30 – 21:30 IST"
  startMin: number; // minutes since IST midnight (may wrap)
  endMin: number;
}

export function istWindowFor(session: SessionKey): IstWindow {
  const w = UTC_WINDOWS[session];
  const startMin = w.startH * 60 + IST_OFFSET_MIN;
  const endMin = w.endH * 60 + IST_OFFSET_MIN;
  return {
    session,
    startMin,
    endMin,
    label: `${fmtIstMinutes(startMin)} – ${fmtIstMinutes(endMin)} IST`,
  };
}

export function istNowMinutes(now = new Date()): number {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + IST_OFFSET_MIN) % 1440;
}

export function isWindowActive(w: IstWindow, nowMin = istNowMinutes()): boolean {
  const start = ((w.startMin % 1440) + 1440) % 1440;
  const end = w.endMin; // may exceed 1440 to indicate wrap
  if (end <= 1440) return nowMin >= start && nowMin < end;
  const endMod = end % 1440;
  return nowMin >= start || nowMin < endMod;
}

export function minutesUntilOpen(w: IstWindow, nowMin = istNowMinutes()): number {
  const start = ((w.startMin % 1440) + 1440) % 1440;
  const diff = (start - nowMin + 1440) % 1440;
  return diff;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}

// Sessions each strategy preset is allowed to enter in (mirrors STRATEGY_PRESETS).
export const PRESET_SESSIONS: Record<string, SessionKey[]> = {
  london_orb: ["london", "london_ny_overlap"],
  liquidity_sweep_long: ["london", "london_ny_overlap", "new_york"],
  vwap_mean_revert: ["london", "new_york", "london_ny_overlap"],
};

export function windowsForPreset(preset: string): IstWindow[] {
  const keys = PRESET_SESSIONS[preset] ?? [];
  return keys.map(istWindowFor);
}
