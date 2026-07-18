import { useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";
import { MobileNavCarousel } from "./mobile-nav-carousel";
import { HeaderLivePnl } from "./header-live-pnl";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/journal": "Journal",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/backtest": "Backtest",
  "/pending-orders": "Pending Orders",
  "/docs": "Docs",
  "/settings": "Settings",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const rawTitle = TITLES[pathname] ?? TITLES[Object.keys(TITLES).find((k) => k !== "/" && pathname.startsWith(k)) ?? "/"] ?? "Shark";
  const title = rawTitle === "Dashboard" ? "" : rawTitle;
  const [open, setOpen] = useState(false);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <AppSidebar />
      <SidebarInset>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-gradient-sunset-vivid focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border/60 bg-background/95 px-3 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/80 sm:px-4">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-sunset-vivid opacity-90" />
          <SidebarTrigger className="md:hidden -ml-1" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              {title ? (
                <h1 className="hidden truncate font-display text-[15px] font-semibold tracking-tight text-gradient-sunset sm:block">
                  {title}
                </h1>
              ) : null}
            </div>

          </div>
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <div className="pointer-events-auto">
              <HeaderLivePnl />
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border/50 bg-gradient-sunset-soft px-2.5 py-1 backdrop-blur-md sm:flex">
            <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_theme(colors.emerald.400)]" />
            </span>
            <span className="text-[11px] font-medium tracking-wide text-foreground/80">Live</span>
          </div>
          <ThemeToggle />
        </header>
        <MobileNavCarousel />
        <main
          id="main-content"
          key={pathname}
          className="min-h-[calc(100dvh-3.5rem)] animate-fade-in pb-20 md:pb-0"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
