// Confirmation module — validates a detected setup against extra conditions.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { ConfirmationConfig, SignalDirection } from "./types";

export interface ConfirmationResult { pass: boolean; passed: string[]; failed: string[] }

export function evalConfirmation(
  bars: EnrichedCandle[],
  i: number,
  direction: SignalDirection,
  level: number,
  cfg: ConfirmationConfig | undefined,
): ConfirmationResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const bar = bars[i];
  if (!cfg) return { pass: true, passed, failed };

  const side = direction === "long" ? 1 : -1;

  if (cfg.requireClose) {
    const ok = side > 0 ? bar.close > level : bar.close < level;
    ok ? passed.push("closeConfirm") : failed.push("closeConfirm");
  }
  if (cfg.minBodyPct !== undefined) {
    const range = bar.high - bar.low || 1e-9;
    const body = Math.abs(bar.close - bar.open) / range * 100;
    body >= cfg.minBodyPct ? passed.push("bodyPct") : failed.push("bodyPct");
  }
  if (cfg.minBreakDistancePct !== undefined) {
    const dist = Math.abs(bar.close - level) / level * 100;
    dist >= cfg.minBreakDistancePct ? passed.push("breakDist") : failed.push("breakDist");
  }
  if (cfg.minVolumeMult !== undefined) {
    const from = Math.max(0, i - 20);
    const window = bars.slice(from, i);
    const avg = window.reduce((a, b) => a + b.volume, 0) / Math.max(1, window.length);
    bar.volume >= avg * cfg.minVolumeMult ? passed.push("volume") : failed.push("volume");
  }
  if (cfg.minAtrMultiple !== undefined) {
    const dist = Math.abs(bar.close - level);
    (bar.atr !== null && dist >= bar.atr * cfg.minAtrMultiple)
      ? passed.push("atrMult") : failed.push("atrMult");
  }
  if (cfg.confirmationBars && cfg.confirmationBars > 1) {
    let ok = true;
    for (let k = 0; k < cfg.confirmationBars; k++) {
      const b = bars[i - k]; if (!b) { ok = false; break; }
      if (side > 0 && b.close <= level) { ok = false; break; }
      if (side < 0 && b.close >= level) { ok = false; break; }
    }
    ok ? passed.push("confirmBars") : failed.push("confirmBars");
  }
  if (cfg.structureAlignment) {
    const wantBull = (direction === "long") === (cfg.structureAlignment === "with");
    const struct = bar.structure;
    const bullStruct = struct === "HH" || struct === "HL";
    (wantBull ? bullStruct : !bullStruct) ? passed.push("structureAlign") : failed.push("structureAlign");
  }
  return { pass: failed.length === 0, passed, failed };
}
