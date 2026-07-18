// Orchestrator — turns raw candles + config into EnrichedCandle[].
import { buildTradingDayMaps, calendarFlags } from "./calendar";
import { adx, anchoredVwap, atr, ema, macd, rollingPercentile, rsi, sma, trueRange } from "./indicators";
import { computeLiquidity } from "./liquidity";
import { activeCustomSessions, classifySession } from "./sessions";
import { computeStructure } from "./structure";
import { formatIsoLocal, isoWeekNumber, localDateKey, quarterOf, toLocal } from "./timezone";
import type { EngineConfig, EnrichedCandle, RawCandle } from "./types";

export function enrichCandles(candles: RawCandle[], cfg: EngineConfig): EnrichedCandle[] {
  const n = candles.length;
  if (n === 0) return [];

  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);
  const ema200 = ema(closes, 200);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const atrArr = atr(candles, cfg.atrLen);
  const trArr = trueRange(candles);
  const atrPct = rollingPercentile(atrArr, cfg.atrPercentileWindow);
  const rsiArr = rsi(closes, 14);
  const macdArr = macd(closes);
  const adxArr = adx(candles, 14);

  const stratTz = cfg.strategyTimezone;
  const sessionKeyFn = (i: number) => classifySession(candles[i].ts) + ":" + localDateKey(candles[i].ts, stratTz);
  const dailyKeyFn = (i: number) => localDateKey(candles[i].ts, stratTz);
  const weeklyKeyFn = (i: number) => {
    const p = toLocal(candles[i].ts, stratTz);
    return `${p.year}-W${isoWeekNumber(candles[i].ts, stratTz)}`;
  };
  const monthlyKeyFn = (i: number) => localDateKey(candles[i].ts, stratTz).slice(0, 7);

  const vwapSession = anchoredVwap(candles, sessionKeyFn);
  const vwapDaily = anchoredVwap(candles, dailyKeyFn);
  const vwapWeekly = anchoredVwap(candles, weeklyKeyFn);
  const vwapMonthly = anchoredVwap(candles, monthlyKeyFn);

  const structure = computeStructure(candles, cfg.swingLookback);
  const liquidity = computeLiquidity(candles, stratTz);

  // Daily / weekly / monthly range so far (per bucket).
  const rangeSoFar = (keyFn: (i: number) => string) => {
    const out: number[] = new Array(n).fill(0);
    let curKey = "", hi = -Infinity, lo = Infinity;
    for (let i = 0; i < n; i++) {
      const k = keyFn(i);
      if (k !== curKey) { curKey = k; hi = -Infinity; lo = Infinity; }
      hi = Math.max(hi, candles[i].high);
      lo = Math.min(lo, candles[i].low);
      out[i] = hi - lo;
    }
    return out;
  };
  const dailyRange = rangeSoFar(dailyKeyFn);
  const weeklyRange = rangeSoFar(weeklyKeyFn);
  const monthlyRange = rangeSoFar(monthlyKeyFn);

  // Opening range per strategy-tz day, starting at cfg.openingRangeSessionStart.
  const orStartMin = cfg.openingRangeSessionStart.hour * 60 + cfg.openingRangeSessionStart.minute;
  const orEndMin = orStartMin + cfg.openingRangeMinutes;
  const orSizePerDay = new Map<string, number>();
  const orMidPerDay = new Map<string, number>();
  {
    const perDay = new Map<string, { hi: number; lo: number }>();
    for (const c of candles) {
      const p = toLocal(c.ts, stratTz);
      const min = p.hour * 60 + p.minute;
      if (min < orStartMin || min >= orEndMin) continue;
      const key = localDateKey(c.ts, stratTz);
      const cur = perDay.get(key);
      if (!cur) perDay.set(key, { hi: c.high, lo: c.low });
      else { cur.hi = Math.max(cur.hi, c.high); cur.lo = Math.min(cur.lo, c.low); }
    }
    for (const [k, v] of perDay) {
      orSizePerDay.set(k, v.hi - v.lo);
      orMidPerDay.set(k, (v.hi + v.lo) / 2);
    }
  }
  const orSizeSeries = candles.map((c) => orSizePerDay.get(localDateKey(c.ts, stratTz)) ?? null);
  const orPctSeries = rollingPercentile(orSizeSeries, 60);

  const timestamps = candles.map((c) => c.ts);
  const calMaps = buildTradingDayMaps(timestamps, stratTz);
  const holidaySet = new Set(cfg.holidays);
  const newsSet = new Set(cfg.newsTimestamps);

  const out: EnrichedCandle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const local = toLocal(c.ts, cfg.displayTimezone);
    const cal = calendarFlags(c.ts, stratTz, holidaySet, calMaps.set, calMaps.firstOfMonth, calMaps.lastOfMonth);
    const dayKey = localDateKey(c.ts, stratTz);
    const orMid = orMidPerDay.get(dayKey) ?? null;
    out[i] = {
      ...c,
      timezone: cfg.displayTimezone,
      isoLocal: formatIsoLocal(c.ts, cfg.displayTimezone),
      weekday: local.weekday,
      hour: local.hour,
      month: local.month,
      quarter: quarterOf(local.month),
      weekNumber: isoWeekNumber(c.ts, cfg.displayTimezone),
      ...cal,
      isNews: newsSet.has(c.ts),
      session: classifySession(c.ts),
      customSessions: activeCustomSessions(c.ts, stratTz, cfg.customSessions),
      trueRange: trArr[i],
      atr: atrArr[i],
      atrPercentile: atrPct[i],
      dailyRange: dailyRange[i],
      weeklyRange: weeklyRange[i],
      monthlyRange: monthlyRange[i],
      openingRangeSize: orSizeSeries[i],
      openingRangePercentile: orPctSeries[i],
      breakDistance: orMid !== null ? Math.abs(c.close - orMid) : null,
      ema20: ema20[i], ema50: ema50[i], ema100: ema100[i], ema200: ema200[i],
      sma20: sma20[i], sma50: sma50[i],
      vwapSession: vwapSession[i],
      vwapDaily: vwapDaily[i],
      vwapWeekly: vwapWeekly[i],
      vwapMonthly: vwapMonthly[i],
      adx: adxArr[i],
      rsi: rsiArr[i],
      macd: macdArr[i],
      swingHigh: structure[i].swingHigh,
      swingLow: structure[i].swingLow,
      structure: structure[i].label,
      bos: structure[i].bos,
      choch: structure[i].choch,
      mss: structure[i].mss,
      prevDayHigh: liquidity[i].prevDayHigh,
      prevDayLow: liquidity[i].prevDayLow,
      prevWeekHigh: liquidity[i].prevWeekHigh,
      prevWeekLow: liquidity[i].prevWeekLow,
      prevMonthHigh: liquidity[i].prevMonthHigh,
      prevMonthLow: liquidity[i].prevMonthLow,
      equalHigh: liquidity[i].equalHigh,
      equalLow: liquidity[i].equalLow,
    };
  }
  return out;
}
