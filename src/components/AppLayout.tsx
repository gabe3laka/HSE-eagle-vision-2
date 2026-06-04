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
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`glass-panel sticky top-0 hidden h-screen flex-col border-r transition-all duration-300 lg:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          {!collapsed && (
            <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Safe<span className="text-primary">Lens</span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {mainNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                  isActive
                    ? "border-l-2 border-primary bg-primary/10 font-medium text-primary shadow-[inset_3px_0_8px_-3px_hsl(152_55%_55%/0.4)]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground hover:scale-[1.02]"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-border p-2">
          {bottomNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                  isActive
                    ? "border-l-2 border-primary bg-primary/10 font-medium text-primary shadow-[inset_3px_0_8px_-3px_hsl(152_55%_55%/0.4)]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground hover:scale-[1.02]"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </Link>
            );
          })}
        </div>

        <div className="border-t border-border p-3">
          {!collapsed && profile && (
            <div className="mb-2 px-1">
              <p className="truncate text-sm font-medium">{profile.full_name || profile.email}</p>
              <p className="truncate text-xs text-muted-foreground">Safety operator</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="glass-panel fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b px-4 lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link to="/" className="flex items-center gap-2 font-display text-base font-bold">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Safe<span className="text-primary">Lens</span>
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
      <main className="dotted-grid mesh-gradient flex-1 overflow-auto">
        <div
          className="container max-w-6xl px-3 pt-16 pb-[calc(env(safe-area-inset-bottom)+88px)] sm:px-4 lg:px-6 lg:py-6 lg:pt-6 page-transition"
        >
          {children}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="glass-panel fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4">
          {mobileNav.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                    isActive ? "bg-primary/15" : ""
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
