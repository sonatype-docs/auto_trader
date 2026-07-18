// Stop Engine — dynamic stop management (break-even, trailing).
export interface StopContext {
  direction: "long" | "short";
  fillPrice: number;
  initialStop: number;
  currentStop: number;
  runnerHigh: number; // for long
  runnerLow: number;  // for short
  breakEvenApplied: boolean;
}

/** R value based on distance from fill to initial stop. */
export function rDistance(ctx: StopContext): number {
  return Math.abs(ctx.fillPrice - ctx.initialStop);
}

/** Current unrealised R multiple given last price. */
export function currentR(ctx: StopContext, price: number): number {
  const r = rDistance(ctx);
  if (r <= 0) return 0;
  return ctx.direction === "long"
    ? (price - ctx.fillPrice) / r
    : (ctx.fillPrice - price) / r;
}

/** Move to break-even after threshold R hit. Mutates ctx. */
export function maybeMoveToBreakEven(
  ctx: StopContext, price: number, atR: number | null,
): boolean {
  if (atR == null || ctx.breakEvenApplied) return false;
  if (currentR(ctx, price) >= atR) {
    ctx.currentStop = ctx.direction === "long"
      ? Math.max(ctx.currentStop, ctx.fillPrice)
      : Math.min(ctx.currentStop, ctx.fillPrice);
    ctx.breakEvenApplied = true;
    return true;
  }
  return false;
}

/** Chandelier-style trailing: keep stop `stepR` behind the runner peak once past `startR`. */
export function maybeTrail(
  ctx: StopContext, price: number, startR: number | null, stepR: number | null,
): boolean {
  if (startR == null || stepR == null) return false;
  const r = rDistance(ctx);
  if (r <= 0) return false;
  if (currentR(ctx, price) < startR) return false;
  const step = r * stepR;
  if (ctx.direction === "long") {
    const newStop = ctx.runnerHigh - step;
    if (newStop > ctx.currentStop) { ctx.currentStop = newStop; return true; }
  } else {
    const newStop = ctx.runnerLow + step;
    if (newStop < ctx.currentStop) { ctx.currentStop = newStop; return true; }
  }
  return false;
}
