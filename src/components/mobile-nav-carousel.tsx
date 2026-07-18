import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, BookOpen, Beaker, ListOrdered, BarChart3, FileText,
  Settings as SettingsIcon, Bot, Target, Sunrise, Zap, GitCompare,
  BookMarked, Database, Cpu, Sparkles, FlaskConical, PlayCircle, Activity,
} from "lucide-react";

type Item = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const items: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "ORB Bot", url: "/bot", icon: Bot },
  { title: "Pending", url: "/pending-orders", icon: ListOrdered },
  { title: "Paper", url: "/paper-trading", icon: Activity },
  { title: "Live", url: "/live-trading", icon: Zap },
  { title: "Fib Zone", url: "/backtest", icon: Beaker },
  { title: "Silver Bullet", url: "/backtest/silver-bullet", icon: Zap },
  { title: "Asian Sweep", url: "/backtest/asian-sweep", icon: Sunrise },
  { title: "ORB BT", url: "/backtest/orb", icon: Target },
  { title: "PDH/PDL", url: "/backtest/pdh-pdl-sweep", icon: Target },
  { title: "Compare", url: "/backtest/compare", icon: GitCompare },
  { title: "Handbook", url: "/handbook", icon: BookMarked },
  { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
  { title: "Market Data", url: "/market-data", icon: Database },
  { title: "Strategy", url: "/strategy-engine", icon: Cpu },
  { title: "Execution", url: "/execution-engine", icon: Zap },
  { title: "Trade Intel", url: "/trade-intelligence", icon: Database },
  { title: "Research", url: "/research", icon: BarChart3 },
  { title: "Optimizer", url: "/optimizer", icon: Sparkles },
  { title: "AI Research", url: "/ai-research", icon: Sparkles },
  { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
  { title: "Docs", url: "/docs", icon: FileText },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

function activeIndex(pathname: string) {
  let best = 0;
  let bestLen = -1;
  items.forEach((i, idx) => {
    const match = i.url === "/" ? pathname === "/" : pathname.startsWith(i.url);
    if (match && i.url.length > bestLen) {
      best = idx;
      bestLen = i.url.length;
    }
  });
  return best;
}

export function MobileNavCarousel() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimer = useRef<number | null>(null);
  const suppressUntil = useRef(0);
  const [focusIdx, setFocusIdx] = useState(() => activeIndex(pathname));

  const centerItem = useCallback((idx: number, behavior: ScrollBehavior = "smooth") => {
    const el = itemRefs.current[idx];
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const target = el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2;
    suppressUntil.current = performance.now() + 600;
    scroller.scrollTo({ left: target, behavior });
  }, []);

  // Sync focus & scroll when route changes externally
  useLayoutEffect(() => {
    const idx = activeIndex(pathname);
    setFocusIdx(idx);
    centerItem(idx, "auto");
  }, [pathname, centerItem]);

  const findNearest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return 0;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    itemRefs.current.forEach((el, idx) => {
      if (!el) return;
      const mid = el.offsetLeft + el.clientWidth / 2;
      const d = Math.abs(mid - center);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    return best;
  }, []);

  const onScroll = useCallback(() => {
    const nearest = findNearest();
    setFocusIdx(nearest);
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      if (performance.now() < suppressUntil.current) return;
      const idx = findNearest();
      const target = items[idx];
      if (!target) return;
      if (target.url !== pathname && !(target.url !== "/" && pathname.startsWith(target.url))) {
        navigate({ to: target.url });
      }
    }, 180);
  }, [findNearest, navigate, pathname]);

  useEffect(() => () => {
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
  }, []);

  return (
    <div
      className="md:hidden fixed bottom-3 left-1/2 z-40 w-[min(96vw,520px)] -translate-x-1/2"
      role="navigation"
      aria-label="Sections"
    >
      <div className="relative rounded-full border border-border/60 bg-background/85 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70">
        {/* gradient fade left */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 rounded-l-full bg-gradient-to-r from-background via-background/80 to-transparent" />
        {/* gradient fade right */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 rounded-r-full bg-gradient-to-l from-background via-background/80 to-transparent" />
        {/* center focus ring */}
        <div className="pointer-events-none absolute inset-y-1.5 left-1/2 z-10 w-[110px] -translate-x-1/2 rounded-full border border-primary/50 bg-primary/10" />

        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory items-center gap-2 overflow-x-auto scroll-smooth px-[calc(50%-55px)] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((i, idx) => {
            const isFocus = idx === focusIdx;
            return (
              <button
                key={i.url}
                type="button"
                ref={(el) => { itemRefs.current[idx] = el; }}
                onClick={() => centerItem(idx)}
                className={[
                  "relative z-20 flex shrink-0 snap-center items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  isFocus
                    ? "text-primary scale-105"
                    : "text-muted-foreground/70 scale-95",
                ].join(" ")}
                aria-current={isFocus ? "page" : undefined}
              >
                <i.icon className="h-3.5 w-3.5" />
                <span className="whitespace-nowrap">{i.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
