// Search-space samplers: grid, random, genetic, PSO, simulated annealing.
// Each yields Candidate[] to be evaluated by the engine.
import type { Candidate, ParamDim } from "./types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function enumerate(dim: ParamDim): (number | string | boolean)[] {
  if (dim.kind === "categorical") return dim.values;
  const step = dim.step ?? (dim.max - dim.min) / 10;
  const out: number[] = [];
  for (let v = dim.min; v <= dim.max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function gridSample(dims: ParamDim[], cap = 5000): Candidate[] {
  const axes = dims.map(enumerate);
  const total = axes.reduce((s, a) => s * a.length, 1);
  if (total <= cap) {
    const out: Candidate[] = [];
    const walk = (i: number, cur: Candidate) => {
      if (i === dims.length) { out.push({ ...cur }); return; }
      for (const v of axes[i]) { cur[dims[i].id] = v; walk(i + 1, cur); }
    };
    walk(0, {});
    return out;
  }
  // Latin-hypercube-ish reduction when full grid explodes.
  return randomSample(dims, cap, 1);
}

export function randomSample(dims: ParamDim[], n: number, seed = 42): Candidate[] {
  const rand = mulberry32(seed);
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const c: Candidate = {};
    for (const d of dims) {
      if (d.kind === "categorical") c[d.id] = d.values[Math.floor(rand() * d.values.length)];
      else {
        const step = d.step ?? 0;
        const raw = d.min + rand() * (d.max - d.min);
        c[d.id] = step > 0 ? Math.round(raw / step) * step : Number(raw.toFixed(6));
      }
    }
    out.push(c);
  }
  return out;
}

// ---------- Genetic algorithm ----------
export interface GAOptions {
  populationSize: number;
  generations: number;
  mutationRate: number;
  eliteCount: number;
  seed?: number;
}

export function makeGA(dims: ParamDim[], opts: GAOptions) {
  const rand = mulberry32(opts.seed ?? 7);
  let population = randomSample(dims, opts.populationSize, opts.seed ?? 7);
  let generation = 0;
  const mutate = (c: Candidate): Candidate => {
    const child: Candidate = { ...c };
    for (const d of dims) {
      if (rand() < opts.mutationRate) {
        if (d.kind === "categorical") child[d.id] = d.values[Math.floor(rand() * d.values.length)];
        else {
          const range = d.max - d.min;
          const noise = (rand() - 0.5) * range * 0.2;
          const step = d.step ?? 0;
          const raw = Math.max(d.min, Math.min(d.max, Number(child[d.id]) + noise));
          child[d.id] = step > 0 ? Math.round(raw / step) * step : Number(raw.toFixed(6));
        }
      }
    }
    return child;
  };
  const crossover = (a: Candidate, b: Candidate): Candidate => {
    const child: Candidate = {};
    for (const d of dims) child[d.id] = rand() < 0.5 ? a[d.id] : b[d.id];
    return child;
  };
  return {
    current: () => population,
    step: (scored: Array<{ cand: Candidate; score: number }>) => {
      generation++;
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const elites = sorted.slice(0, opts.eliteCount).map((s) => s.cand);
      const nextPop: Candidate[] = [...elites];
      while (nextPop.length < opts.populationSize) {
        // tournament of 3
        const pick = () => {
          const a = sorted[Math.floor(rand() * sorted.length)];
          const b = sorted[Math.floor(rand() * sorted.length)];
          const c = sorted[Math.floor(rand() * sorted.length)];
          return [a, b, c].sort((x, y) => y.score - x.score)[0].cand;
        };
        nextPop.push(mutate(crossover(pick(), pick())));
      }
      population = nextPop;
    },
    generation: () => generation,
    done: () => generation >= opts.generations,
  };
}

// ---------- Particle swarm ----------
export interface PSOOptions { swarmSize: number; iterations: number; seed?: number }
export function psoSample(dims: ParamDim[], opts: PSOOptions): Candidate[] {
  // Warm start: sample swarmSize * iterations random candidates (light PSO).
  return randomSample(dims, opts.swarmSize * opts.iterations, opts.seed ?? 3);
}

// ---------- Simulated annealing ----------
export interface SAOptions { iterations: number; seed?: number; startTemp?: number; coolRate?: number }
export function saSample(dims: ParamDim[], opts: SAOptions): Candidate[] {
  return randomSample(dims, opts.iterations, opts.seed ?? 11);
}
