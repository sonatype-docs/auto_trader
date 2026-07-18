// Verification panel — shows the curated top-10 selection (BTC vs XAU, strategy,
// venue, existing status) and lets the user confirm before replacing live runners.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  previewTopSelection, replaceLiveRunnersWithTopSelection,
  type ReplaceReportDTO,
} from "@/lib/live-trading.functions";

export function TopRunnersVerificationCard() {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewTopSelection);
  const replaceFn = useServerFn(replaceLiveRunnersWithTopSelection);
  const [startImmediately, setStartImmediately] = useState(false);
  const [report, setReport] = useState<ReplaceReportDTO | null>(null);
  const [open, setOpen] = useState(false);

  const preview = useQuery({
    queryKey: ["top-runners-preview"],
    queryFn: () => previewFn(),
  });

  const replaceMut = useMutation({
    mutationFn: () => replaceFn({ data: { startImmediately } }),
    onSuccess: (r) => {
      setReport(r);
      qc.invalidateQueries({ queryKey: ["live-runners"] });
      qc.invalidateQueries({ queryKey: ["live-trades"] });
      qc.invalidateQueries({ queryKey: ["top-runners-preview"] });
    },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : String(e)),
  });

  const sel = preview.data?.selection ?? [];
  const existing = preview.data?.existing ?? [];
  const btcCount = sel.filter((s) => s.symbol === "BTCUSDT").length;
  const xauCount = sel.filter((s) => s.symbol === "XAUUSDT").length;

  const matchExisting = (sy: string, tf: string, sp: string) =>
    existing.find((e) => e.symbol === sy && e.timeframe === tf && e.strategy_preset === sp);

  const onConfirm = () => {
    const msg = existing.length > 0
      ? `This will DELETE ${existing.length} existing live runner(s) and ALL their live_trades, then insert the ${sel.length} curated runners${startImmediately ? " and START them immediately" : " (stopped, review then start)"}.\n\nContinue?`
      : `Insert the ${sel.length} curated runners${startImmediately ? " and START them immediately" : " (stopped, review then start)"}?`;
    if (!confirm(msg)) return;
    replaceMut.mutate();
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
          <CardTitle className="truncate">Verify curated top 10</CardTitle>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          <Badge variant="outline" className="font-mono">BTC × {btcCount}</Badge>
          <Badge variant="outline" className="font-mono">XAU × {xauCount}</Badge>
          <Button size="sm" variant="ghost" onClick={() => preview.refetch()} disabled={preview.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${preview.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4">

        {preview.isLoading && <div className="text-sm text-muted-foreground">Loading selection…</div>}
        {preview.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(preview.error as Error).message}
          </div>
        )}

        {/* Selection table */}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>TF</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Robustness</TableHead>
                <TableHead>Existing status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sel.map((r, i) => {
                const match = matchExisting(r.symbol, r.timeframe, r.strategy_preset);
                const isBtc = r.symbol === "BTCUSDT";
                return (
                  <TableRow key={`${r.symbol}-${r.timeframe}-${r.strategy_preset}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium text-sm">{r.label}</TableCell>
                    <TableCell>
                      <Badge className={isBtc
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                        : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"}
                        variant="outline">
                        {isBtc ? "BTC" : "XAU"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.strategy_preset}</TableCell>
                    <TableCell className="text-xs font-mono">{r.timeframe}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.source}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{r.robustness}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {match ? (
                        match.running
                          ? <span className="text-emerald-500">● present · LIVE</span>
                          : <span className="text-muted-foreground">● present · stopped</span>
                      ) : (
                        <span className="text-primary">＋ will be added</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Deletion preview */}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Trash2 className="h-4 w-4 text-destructive" />
            Will remove {existing.length} existing runner(s) and all their live trades
          </div>
          {existing.length === 0 ? (
            <div className="text-xs text-muted-foreground">No existing runners — nothing to delete.</div>
          ) : (
            <ul className="text-xs space-y-0.5 max-h-40 overflow-auto">
              {existing.map((e) => (
                <li key={e.id} className="font-mono text-muted-foreground">
                  − {e.label} <span className="opacity-60">({e.symbol} · {e.timeframe} · {e.strategy_preset})</span>
                  {e.running && <span className="text-destructive"> · LIVE</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={startImmediately}
              onCheckedChange={(v) => setStartImmediately(v === true)}
            />
            Start immediately after replacing (skip manual review)
          </label>
          <div className="sm:ml-auto flex gap-2">
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={replaceMut.isPending || preview.isLoading}
            >
              {replaceMut.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Replacing…</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-1" /> Confirm & replace</>
              )}
            </Button>
          </div>
        </div>

        {/* Post-replace report */}
        {report && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Replacement complete
              {report.startRequested && <Badge className="bg-destructive text-destructive-foreground">STARTED</Badge>}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground uppercase font-mono">Deleted runners</div>
                <div className="text-lg font-semibold">{report.deleted.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase font-mono">Deleted live trades</div>
                <div className="text-lg font-semibold">{report.deletedTrades}</div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase font-mono">Inserted runners</div>
                <div className="text-lg font-semibold">{report.inserted.length}</div>
              </div>
            </div>
            {report.deleted.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Show deleted runners ({report.deleted.length})</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {report.deleted.map((d) => (
                    <li key={d.id} className="text-muted-foreground">
                      − {d.label} <span className="opacity-60">({d.symbol} · {d.timeframe} · {d.strategy_preset})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!report.startRequested && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                New runners inserted as <b>stopped</b>. Review below then toggle on.
              </div>
            )}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
