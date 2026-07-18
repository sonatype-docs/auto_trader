import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { windowsForPreset } from "@/lib/session-windows";

interface Props {
  preset: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 border-b border-border/40 last:border-b-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">{title}</h4>
      <div className="rounded-md border border-border/60 bg-card/50 px-3 py-1">{children}</div>
    </div>
  );
}

export function StrategyDetailsDialog({ preset, open, onOpenChange }: Props) {
  const cfg = STRATEGY_PRESETS[preset];
  const windows = windowsForPreset(preset);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {cfg?.strategyName ?? preset}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Preset id: <code className="font-mono">{preset}</code>
          </DialogDescription>
        </DialogHeader>

        {!cfg ? (
          <p className="text-sm text-muted-foreground">Unknown strategy preset — no configuration found.</p>
        ) : (
          <div className="space-y-4">
            <Section title="Entry windows (IST)">
              {windows.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No session restriction — always eligible.</p>
              ) : (
                <div className="flex flex-wrap gap-2 py-2">
                  {windows.map((w) => (
                    <Badge key={w.session} variant="outline" className="font-mono text-xs">
                      {w.session.replace(/_/g, " ")} · {w.label}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="pb-2 text-[11px] text-muted-foreground">
                Overlapping sessions collapse into one continuous window when adjacent (e.g. London 12:30–21:30 IST and NY 17:30–02:30 IST cover 12:30 IST → 02:30 IST next day).
              </p>
            </Section>

            <Section title="Direction & bias">
              <Row label="Direction" value={<Badge variant="secondary">{cfg.direction}</Badge>} />
              {cfg.trend?.emaAlignment && (
                <Row label="EMA alignment" value={<code className="font-mono text-xs">{JSON.stringify(cfg.trend.emaAlignment)}</code>} />
              )}
              {cfg.trend?.vwapSide && <Row label="VWAP side" value={cfg.trend.vwapSide} />}
              {cfg.trend?.adxMin != null && <Row label="ADX min" value={cfg.trend.adxMin} />}
              {cfg.trend?.adxMax != null && <Row label="ADX max" value={cfg.trend.adxMax} />}
            </Section>

            <Section title="Volatility filter">
              {cfg.volatility?.atrPercentileMin != null && <Row label="ATR%ile min" value={cfg.volatility.atrPercentileMin} />}
              {cfg.volatility?.atrPercentileMax != null && <Row label="ATR%ile max" value={cfg.volatility.atrPercentileMax} />}
              {!cfg.volatility && <p className="py-2 text-sm text-muted-foreground">No volatility filter.</p>}
            </Section>

            <Section title="Setup / trigger">
              <Row label="Kind" value={<code className="font-mono text-xs">{cfg.setup.kind}</code>} />
              {"breakBufferPct" in cfg.setup && cfg.setup.breakBufferPct != null && (
                <Row label="Break buffer %" value={cfg.setup.breakBufferPct} />
              )}
            </Section>

            <Section title="Confirmation">
              {cfg.confirmation?.requireClose != null && <Row label="Requires bar close" value={String(cfg.confirmation.requireClose)} />}
              {cfg.confirmation?.minBodyPct != null && <Row label="Min candle body %" value={cfg.confirmation.minBodyPct} />}
              {cfg.confirmation?.minAtrMultiple != null && <Row label="Min ATR multiple" value={cfg.confirmation.minAtrMultiple} />}
            </Section>

            <Section title="Entry">
              <Row label="Model" value={<code className="font-mono text-xs">{JSON.stringify(cfg.entry.model)}</code>} />
              {cfg.entry.expiryBars != null && <Row label="Order expiry (bars)" value={cfg.entry.expiryBars} />}
            </Section>

            <Section title="Stop loss">
              <Row label="Kind" value={<code className="font-mono text-xs">{cfg.stop.kind}</code>} />
              {"multiple" in cfg.stop && cfg.stop.multiple != null && (
                <Row label="ATR / range multiple" value={cfg.stop.multiple} />
              )}
            </Section>

            <Section title="Take profit / management">
              <Row
                label="Target legs"
                value={
                  <ol className="list-decimal pl-4 text-sm">
                    {cfg.targets.legs.map((l, i) => (
                      <li key={i}>
                        <span className="font-mono">{l.kind}</span>
                        {"value" in l && l.value != null ? ` @ ${l.value}` : ""}
                        {l.sizePct != null ? ` · ${l.sizePct}% of size` : ""}
                      </li>
                    ))}
                  </ol>
                }
              />
              {cfg.targets.moveToBreakEvenAtR != null && (
                <Row label="Move to BE at R" value={cfg.targets.moveToBreakEvenAtR} />
              )}
              {cfg.targets.trailAfterR != null && (
                <Row label="Trail after R" value={cfg.targets.trailAfterR} />
              )}
              {cfg.targets.trailStepR != null && (
                <Row label="Trail step R" value={cfg.targets.trailStepR} />
              )}
              {cfg.management?.maxDailyTrades != null && (
                <Row label="Max trades / day" value={cfg.management.maxDailyTrades} />
              )}
              {cfg.management?.timeStopBars != null && (
                <Row label="Time stop (bars)" value={cfg.management.timeStopBars} />
              )}
            </Section>

            <Section title="Invalidation">
              {cfg.invalidation?.maxDelayBars != null && (
                <Row label="Max delay (bars)" value={cfg.invalidation.maxDelayBars} />
              )}
              {cfg.invalidation?.invalidateOnSessionEnd != null && (
                <Row label="Invalidate on session end" value={String(cfg.invalidation.invalidateOnSessionEnd)} />
              )}
              {cfg.invalidation?.invalidateOnStructureFlip != null && (
                <Row label="Invalidate on structure flip" value={String(cfg.invalidation.invalidateOnStructureFlip)} />
              )}
            </Section>

            <Section title="Risk">
              {cfg.risk?.riskPerTradeUsd != null && (
                <Row label="Risk per trade (base)" value={`$${cfg.risk.riskPerTradeUsd}`} />
              )}
              <p className="py-2 text-[11px] text-muted-foreground">
                Actual per-trade risk uses the runner's <em>Risk $</em> and <em>Leverage</em>, not the preset default.
              </p>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
