import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  BookOpen,
  Beaker,
  ListOrdered,
  BarChart3,
  FileText,
  Settings as SettingsIcon,
  Waves,
  Bot,
  Target,
  Sunrise,
  Zap,
  GitCompare,
  BookMarked,
  Database,
  Cpu,
  Sparkles,
  FlaskConical,
  ChevronsLeft,
  ChevronsRight,
  PlayCircle,
  Activity,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const primary = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Reports", url: "/reports", icon: FileText },
];

const trading = [
  { title: "ORB Bot", url: "/bot", icon: Bot },
  { title: "Pending Orders", url: "/pending-orders", icon: ListOrdered },
  { title: "Paper Trading", url: "/paper-trading", icon: Activity },
  { title: "Live Trading Bot", url: "/live-trading", icon: Zap },
];

const backtest = [
  { title: "Fib Zone Lab", url: "/backtest", icon: Beaker },
  { title: "Silver Bullet", url: "/backtest/silver-bullet", icon: Zap },
  { title: "Asian Sweep", url: "/backtest/asian-sweep", icon: Sunrise },
  { title: "Multi-Session ORB", url: "/backtest/orb", icon: Target },
  { title: "PDH/PDL Sweep", url: "/backtest/pdh-pdl-sweep", icon: Waves },
  { title: "Compare all", url: "/backtest/compare", icon: GitCompare },
];

const meta = [
  { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
  { title: "Market Data Engine", url: "/market-data", icon: Database },
  { title: "Strategy Engine", url: "/strategy-engine", icon: Cpu },
  { title: "Execution Engine", url: "/execution-engine", icon: Zap },
  { title: "Trade Intelligence", url: "/trade-intelligence", icon: Database },
  { title: "Research", url: "/research", icon: BarChart3 },
  { title: "Optimizer", url: "/optimizer", icon: Sparkles },
  { title: "AI Research", url: "/ai-research", icon: Sparkles },
  { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
  { title: "Docs", url: "/docs", icon: FileText },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];


export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => (u === "/" ? pathname === "/" : pathname.startsWith(u));

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/60">
      <SidebarHeader className="border-b border-sidebar-border/60">
        <div className="flex items-center gap-2.5 px-2 py-2.5">
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-sunset-vivid text-white glow-sunset">
            <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-transparent to-white/20" aria-hidden />
            <Waves className="relative h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate font-display text-sm font-semibold tracking-tight text-gradient-sunset">Shark Auto-Trader</div>
            <div className="truncate text-[11px] text-muted-foreground/80">Live control panel</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((i) => (
                <SidebarMenuItem key={i.url}>
                  <SidebarMenuButton asChild isActive={isActive(i.url)} tooltip={i.title}>
                    <Link to={i.url}>
                      <i.icon className="h-4 w-4" />
                      <span>{i.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Trading</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {trading.map((i) => (
                <SidebarMenuItem key={i.url}>
                  <SidebarMenuButton asChild isActive={isActive(i.url)} tooltip={i.title}>
                    <Link to={i.url}>
                      <i.icon className="h-4 w-4" />
                      <span>{i.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Backtest</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {backtest.map((i) => (
                <SidebarMenuItem key={i.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={i.url === "/backtest" ? pathname === "/backtest" : isActive(i.url)}
                    tooltip={i.title}
                  >
                    <Link to={i.url}>
                      <i.icon className="h-4 w-4" />
                      <span>{i.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Handbook</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/handbook" || pathname.startsWith("/handbook")}
                  tooltip="XAU/USD Handbook"
                >
                  <Link to="/handbook">
                    <BookMarked className="h-4 w-4" />
                    <span>XAU/USD Handbook</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/handbook/v1/london-orb")}
                  tooltip="London ORB"
                >
                  <Link to="/handbook/$volume/$strategy" params={{ volume: "v1", strategy: "london-orb" }}>
                    <Target className="h-4 w-4" />
                    <span>London ORB</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>


        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {meta.map((i) => (
                <SidebarMenuItem key={i.url}>
                  <SidebarMenuButton asChild isActive={isActive(i.url)} tooltip={i.title}>
                    <Link to={i.url}>
                      <i.icon className="h-4 w-4" />
                      <span>{i.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60">
        <CollapseToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

function CollapseToggle() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
    >
      {collapsed
        ? <ChevronsRight className="h-4 w-4 shrink-0" />
        : <ChevronsLeft className="h-4 w-4 shrink-0" />}
      <span className="group-data-[collapsible=icon]:hidden">
        {collapsed ? "Expand" : "Collapse"}
      </span>
    </button>
  );
}
