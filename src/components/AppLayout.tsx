import { Link, useLocation } from "@/lib/router-shim";
import { useAuth } from "@/contexts/AuthContext";
import {
  Camera,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Radio,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mainNav = [
  { path: "/", label: "Live", icon: Camera },
  { path: "/overview", label: "Overview", icon: LayoutDashboard },
  { path: "/incidents", label: "Incidents", icon: ShieldAlert },
];

const bottomNav = [{ path: "/settings", label: "Settings", icon: Settings }];

const mobileNav = [...mainNav, ...bottomNav];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-shell flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`app-sidebar sticky top-0 hidden h-screen flex-col transition-all duration-300 lg:flex ${
          collapsed ? "w-[76px]" : "w-[272px]"
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/5 px-4">
          {!collapsed && (
            <Link
              to="/"
              className="flex items-center gap-3 font-display text-lg font-bold"
              aria-label="SafeLens home"
            >
              <span className="brand-mark">
                <ShieldCheck className="h-5 w-5 text-slate-950" />
              </span>
              <span className="leading-tight">
                <span className="block">SafeLens</span>
                <span className="block text-[9px] font-semibold uppercase tracking-[0.24em] text-cyan-300/70">
                  Operator console
                </span>
              </span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`rounded-lg border border-white/5 bg-white/[0.03] p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground ${collapsed ? "mx-auto" : ""}`}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && (
          <div className="mx-3 mt-4 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.04] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <Radio className="h-3.5 w-3.5 text-cyan-300" />
              Field system ready
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Live safety, procedure capture, and guided planning in one workspace.
            </p>
          </div>
        )}

        <nav className="flex-1 space-y-1 p-3">
          {!collapsed && <p className="nav-section-label">Workspace</p>}
          {mainNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-link flex min-h-[46px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                  isActive
                    ? "sidebar-link-active font-medium text-cyan-100"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon">
                  <item.icon className="h-4 w-4 shrink-0" />
                </span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-white/5 p-3">
          {!collapsed && <p className="nav-section-label">System</p>}
          {bottomNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-link flex min-h-[46px] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                  isActive
                    ? "sidebar-link-active font-medium text-cyan-100"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon">
                  <item.icon className="h-4 w-4 shrink-0" />
                </span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </Link>
            );
          })}
        </div>

        <div className="border-t border-white/5 p-3">
          {!collapsed && profile && (
            <div className="mb-2 flex items-center gap-3 rounded-xl bg-white/[0.03] p-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300/20 to-violet-400/20 text-cyan-100">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{profile.full_name || profile.email}</p>
                <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                  Safety operator
                </p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10 w-full justify-start rounded-xl text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="mobile-topbar fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between px-4 lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link
          to="/"
          className="flex items-center gap-2.5 font-display text-base font-bold"
          aria-label="SafeLens home"
        >
          <span className="brand-mark h-8 w-8">
            <ShieldCheck className="h-4 w-4 text-slate-950" />
          </span>
          <span>SafeLens</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-destructive"
          onClick={signOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {/* Main content */}
      <main className="console-canvas flex-1 overflow-auto">
        <div className="container max-w-[1480px] px-3 pt-20 pb-[calc(env(safe-area-inset-bottom)+92px)] sm:px-5 lg:px-8 lg:py-7 lg:pt-7 page-transition">
          {children}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="mobile-tabbar fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4">
          {mobileNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium transition-colors ${
                  isActive ? "text-cyan-200" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                    isActive ? "bg-cyan-300/10 ring-1 ring-cyan-300/15" : ""
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
