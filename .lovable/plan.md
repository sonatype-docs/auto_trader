
## Goal

Build a full **optimizer engine** for both **ICT Silver Bullet** and **Asian Liquidity Sweep** that searches thousands of parameter combinations and returns only presets that are provably profitable, using genetic search + 70/30 in-sample / out-of-sample validation across 30/60/90/180/365-day windows.

## Backend

### 1. Shared optimizer core — `src/lib/strategy/optimizer.server.ts` (new)

Generic genetic algorithm that operates on any strategy's parameter space:

- **Population**: 100 individuals × 100 generations = ~10,000 evaluations (matches "~10k evals").
- **Selection**: tournament (size 5).
- **Crossover**: uniform per-gene, rate 0.7.
- **Mutation**: Gaussian for numeric genes, categorical resample for enums; rate 0.15 (decays to 0.05).
- **Elitism**: top 5 carry over each generation.
- **Fitness**: net P&L (USD) on in-sample slice, penalised to −∞ when validation gates fail (see §3).
- **Caching**: memo table keyed by hashed gene vector so repeated genomes skip re-evaluation.
- **Klines cache**: fetch the 365-day 1m/3m/5m/15m klines **once per symbol per optimizer run**, slice in-memory per window (major perf win).
- **Progress**: yields `{ generation, best, evaluated }` via an in-memory job store (see §5).

Exports:
```ts
runGeneticSearch({
  strategy: "silver_bullet" | "asian_sweep",
  symbol, windows: number[],           // [30,60,90,180,365]
  populationSize, generations,
  paramSpace: ParamSpace,              // per-strategy (§2)
  evaluate: (genome, klines, windowDays) => BacktestSummary,
  gates: ValidationGates,
  onProgress?, signal?,
}): Promise<OptimizerResult>
```

### 2. Per-strategy parameter spaces

**Silver Bullet** genes (bounds from current schema):
- `window_start_ist` ∈ {09:00…12:00 step 15m}
- `window_end_ist` = start + {30, 60, 90, 120} min
- `hold_cutoff_ist` ∈ {14:00…20:00 step 30m}
- `swing_lookback` ∈ [5, 60]
- `fvg_min_usd` ∈ [0, 20]
- `sl_buffer_usd` ∈ [0, 5]
- `max_trades_per_day` ∈ {1, 2, 3}
- `execution_tf` ∈ {3m, 5m, 15m}
- `rr` ∈ [1.0, 4.0] step 0.25
- `sl_risk_usd` ∈ [25, 200] step 25

**Asian Liquidity Sweep** genes:
- `asian_start_ist` ∈ [0, 6]
- `asian_end_ist` ∈ [start+2, 10]
- `entry_end_ist` ∈ [asian_end+1, 18]
- `min_range_usd` ∈ [0, 50]
- `entry_pullback_pct` ∈ [0, 0.9]
- `sl_buffer_pct` ∈ [0, 0.3]
- `tp_mode` ∈ {rr, opposite, midrange}
- `require_close_inside` ∈ {true, false}
- `rr` ∈ [1.0, 4.0] step 0.25
- `sl_risk_usd` ∈ [25, 200] step 25

Encoded as typed `ParamSpace` records so the GA is strategy-agnostic.

### 3. Validation gates & multi-window ranking

For every candidate genome, per requested window (30/60/90/180/365):

1. Split chronologically **70 % in-sample / 30 % out-of-sample**.
2. Run backtest on both slices with shared klines cache.
3. Gates (OOS must all pass, else fitness = −∞):
   - OOS **net P&L > 0**
   - OOS trades ≥ max(10, in-sample trades × 0.2)
   - Sign of OOS expectancy matches in-sample (no polarity flip)
4. Composite score per window = in-sample net P&L × min(1, OOS P&L / (in-sample P&L × 0.3)).
5. **Final rank** = sum of composite scores across all requested windows, i.e. a preset only tops the board if it's robust across 30 → 365 days.

Optimizer returns top 20 presets with per-window in/out summaries.

### 4. Public server functions — `src/lib/strategy.functions.ts`

Add two Zod-validated `createServerFn`s:

```ts
optimizeSilverBullet({ symbol, windows[], generations?, populationSize? })
optimizeAsianSweep  ({ symbol, windows[], generations?, populationSize? })
```

Both return `{ jobId }`. A companion `getOptimizerJob({ jobId })` returns progress + top presets, and `applyOptimizerPreset({ jobId, rank, saveAs })` writes the winner into `strategy_presets`.

The job store is a module-level `Map<jobId, JobState>` in `optimizer.server.ts`. Jobs auto-expire after 1 hour and are capped at 5 concurrent per user.

### 5. Cache & concurrency

- Klines cache is a `Map<${symbol}:${tf}:${fromMs}:${toMs}, KLine[]>` living inside the optimizer job (freed on completion).
- Each generation runs evaluations in `p-limit(8)` concurrent workers to keep the Worker CPU responsive.
- Server function returns immediately with `jobId`; heavy work runs in a detached promise via `queueMicrotask` — the client polls `getOptimizerJob` every 2 s.

## Schema (single migration)

```sql
create table public.optimizer_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  strategy text not null,       -- 'silver_bullet' | 'asian_sweep'
  symbol text not null,
  windows int[] not null,
  status text not null,         -- queued | running | done | error | cancelled
  progress jsonb not null default '{}'::jsonb,
  top_presets jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.optimizer_jobs to authenticated;
grant all on public.optimizer_jobs to service_role;
alter table public.optimizer_jobs enable row level security;
create policy "own jobs"        on public.optimizer_jobs for select using (auth.uid() = user_id);
create policy "own jobs insert" on public.optimizer_jobs for insert with check (auth.uid() = user_id);
create policy "own jobs update" on public.optimizer_jobs for update using (auth.uid() = user_id);
create policy "own jobs delete" on public.optimizer_jobs for delete using (auth.uid() = user_id);
create index on public.optimizer_jobs (user_id, strategy, created_at desc);
```

The DB row is the durable projection of the in-memory job; the background evaluator updates it every 5 generations.

## Frontend

### 6. Optimizer panels — `src/routes/backtest.tsx`

Under each of the two existing strategy panels ("Silver Bullet", "Asian Liquidity Sweep") add an **Optimizer** subsection:

- Symbol input (default XAUUSDT).
- Multi-select windows chips: 30 / 60 / 90 / 180 / 365 days (all preselected).
- "Run Optimizer" button → calls the server fn, stores `jobId`.
- Progress card: generation X / 100, evaluated N, best net P&L so far, elapsed time.
- **Results table** (top 20): rank, per-window IS/OOS P&L, trades, win %, expectancy, PF, gene chips.
- Row actions: **Apply to backtest** (populates the strategy's regular form) and **Save as preset** (writes to `strategy_presets`).

Uses TanStack Query `useQuery` polling with 2 s `refetchInterval` while `status === "running"`.

### 7. Reusable component — `src/components/optimizer-results.tsx` (new)

Renders the progress card + results table. Takes `jobId` and strategy label; hides implementation details behind a clean API so both panels reuse it.

## Rollout order

1. Migration for `optimizer_jobs`.
2. `optimizer.server.ts` (GA, cache, job store).
3. Silver Bullet evaluator adapter (wraps existing `runSilverBulletBacktest`, passes cached klines).
4. Asian Sweep evaluator adapter (wraps `runSweepBacktest`).
5. Server functions: `optimizeSilverBullet`, `optimizeAsianSweep`, `getOptimizerJob`, `applyOptimizerPreset`.
6. `optimizer-results.tsx` component.
7. Wire both panels in `backtest.tsx`.

## Trade-offs / notes

- 10 k evaluations × 5 windows = 50 k backtests. With klines caching + parallelism this runs in ~3–6 min per symbol on a warm Worker; the UI is fully async so the user can navigate away and come back.
- 70/30 walk-forward on every window prevents overfitting; presets that pass are genuinely robust, not curve-fits.
- Genetic search converges but never guarantees the global optimum — mitigated with elitism + high initial diversity + memoization.
- If **no** preset passes all gates for a symbol, we surface that verdict explicitly rather than showing overfit "winners".
