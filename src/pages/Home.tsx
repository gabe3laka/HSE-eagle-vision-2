import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@/lib/router-shim";
import { Camera, ClipboardCheck, EyeOff, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useIncidents } from "@/hooks/useIncidents";
import { HAZARDS } from "@/lib/detection/hazardCatalog";
import { hazardIcon } from "@/components/live/hazardIcons";
import { SeverityBadge, severityStripeClass, SEVERITY_RANK } from "@/components/ui/severity";
import { HomeComposer } from "@/features/report-composer/HomeComposer";
import { ConversationHistory } from "@/features/report-composer/ConversationHistory";
import { ConversationThread } from "@/features/report-composer/ConversationThread";
import { RecentDrafts } from "@/features/report-composer/RecentDrafts";
import { HeroScene } from "@/components/landing/HeroScene";
import { BRAND } from "@/lib/brand";

/* ------------------------------------------------------------------ */
/* Signed-in home: composer + "what happened" activity                 */
/* ------------------------------------------------------------------ */

/** Compact activity strip under the composer: the pending-approval queue and
 *  the latest confirmed incidents, so Home answers "what happened?" at a
 *  glance and links into the tabs that own each item. */
function WhatHappened() {
  const { data: incidents } = useIncidents();

  const { pending, recent } = useMemo(() => {
    const list = incidents ?? [];
    return {
      pending: list.filter((i) => i.review_status === "pending"),
      recent: list
        .filter((i) => i.review_status === "approved")
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
        .slice(0, 3),
    };
  }, [incidents]);

  if (pending.length === 0 && recent.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      {pending.length > 0 && (
        <Link
          to="/incidents"
          className="hover-lift pressable flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 hover:bg-warning/15"
        >
          <span className="flex items-center gap-2.5 text-sm">
            <ClipboardCheck className="h-4 w-4 text-warning" aria-hidden />
            <span>
              <b className="font-semibold text-warning">
                {pending.length} detection{pending.length === 1 ? "" : "s"}
              </b>{" "}
              waiting for your approval
            </span>
          </span>
          <span className="text-xs font-medium text-warning">Review →</span>
        </Link>
      )}

      {recent.length > 0 && (
        <div>
          <p className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Recent incidents</span>
            <Link to="/incidents" className="normal-case text-primary hover:underline">
              View all
            </Link>
          </p>
          <div className="space-y-1.5">
            {recent.map((inc) => {
              const Icon = hazardIcon(inc.hazard_type);
              return (
                <div
                  key={inc.id}
                  className={`hover-lift flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm ${severityStripeClass(inc.severity)}`}
                >
                  <span className="rounded-md border border-border bg-secondary/60 p-1.5 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{HAZARDS[inc.hazard_type].label}</span>
                  <SeverityBadge level={inc.severity} size="sm" />
                  <span className="hidden text-xs tabular text-muted-foreground sm:inline">
                    {new Date(inc.occurred_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AuthedHome() {
  const { profile } = useAuth();
  const name = profile?.full_name?.split(" ")[0] || null;
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  return (
    <AppLayout>
      <div className="mesh-hero mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col justify-center px-1 py-6">
        <div className="animate-fade-in-up mb-6 text-center">
          <span className="brand-mark mx-auto mb-5 flex h-11 w-11 items-center justify-center">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h1 className="display-hero">
            {name ? (
              <>
                What happened, <span className="text-gradient-brand">{name}</span>?
              </>
            ) : (
              <>
                What happened on <span className="text-gradient-brand">site</span>?
              </>
            )}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Describe a hazard or near-miss and the agent drafts a safety report for you to review —
            or pick a mode to open the live camera.
          </p>
        </div>

        <div className="animate-fade-in-up" style={{ animationDelay: "70ms" }}>
          <HomeComposer
            activeConversationId={activeConversationId}
            onConversationChange={setActiveConversationId}
          />
        </div>

        <p
          className="animate-fade-in-up mt-4 text-center text-[11px] text-muted-foreground"
          style={{ animationDelay: "140ms" }}
        >
          Nothing is filed automatically — every report is yours to review, edit, and approve.
        </p>

        <ConversationThread conversationId={activeConversationId} />

        <div className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <ConversationHistory
            activeConversationId={activeConversationId}
            onSelect={setActiveConversationId}
            onNew={() => setActiveConversationId(null)}
          />

          <WhatHappened />
          <RecentDrafts />
        </div>
      </div>
    </AppLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Signed-out home: the public landing (Lovable pattern)               */
/* ------------------------------------------------------------------ */

const PUBLIC_POINTS = [
  {
    icon: Camera,
    title: "That lens runs live",
    text: "The same overlay, on your phone's camera, at ~2s per frame.",
  },
  {
    icon: Zap,
    title: "Report by just describing it",
    text: "Type or photograph what happened; the agent drafts the safety report for your review.",
  },
  {
    icon: EyeOff,
    title: "Nothing files itself",
    text: "Every detection lands in a review queue for a human to approve, edit or reject.",
  },
];

/** The three cards arrive on scroll (IntersectionObserver + the existing
 *  animate-fade-in-up, staggered 70ms) instead of just sitting there. */
function PublicPoints() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="mt-12 grid gap-4 sm:grid-cols-3">
      {PUBLIC_POINTS.map((p, i) => (
        <div
          key={p.title}
          className={`console-panel hover-lift rounded-xl p-5 ${seen ? "animate-fade-in-up" : "opacity-0"}`}
          style={seen ? { animationDelay: `${i * 70}ms` } : undefined}
        >
          <span className="glyph-halo mb-3 h-10 w-10">
            <p.icon className="h-4.5 w-4.5 text-primary" />
          </span>
          <h3 className="mt-2.5 text-sm font-semibold">{p.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.text}</p>
        </div>
      ))}
    </div>
  );
}

/** The public front door — visitor lands directly on the product's input, the
 *  way lovable.dev works: one hero line, the composer (visible but gated), and
 *  Sign in in the corner. Replaces the old standalone /landing page. */
function PublicHome() {
  const navigate = useNavigate();
  const toAuth = () => navigate("/auth");
  const { isAnonymous, credits } = useAuth();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* The living scene IS the page (Kage's fixed-world pattern): the lens
          sweeps the whole viewport, and everything below scrolls over it. */}
      <HeroScene />

      {/* Content plane. pointer-events pass through empty areas so the lens
          tracks there; each interactive block re-enables its own events. */}
      <div className="pointer-events-none relative z-10">
        {/* First frame: nav + centred copy + the composer, one viewport tall */}
        <section className="relative flex min-h-svh flex-col">
          {/* top scrim holds the nav and headline off the scene (Kage) */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[42%]"
            style={{
              background:
                "linear-gradient(180deg, hsl(var(--background) / 0.85), hsl(var(--background) / 0.35) 55%, transparent)",
            }}
          />

          {/* Floating dock header — translucent panel with a lit top edge; no
              backdrop-filter over a canvas that repaints (Sylva's perf note). */}
          <header
            className="pointer-events-auto relative z-10 mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-3xl items-center justify-between rounded-2xl border border-white/10 px-4 py-2.5 sm:px-5"
            style={{
              paddingTop: "max(env(safe-area-inset-top), 10px)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0) 42%), hsl(var(--card) / 0.74)",
              boxShadow: "0 8px 22px rgba(2,6,12,0.3), inset 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <span className="flex items-center gap-2.5 font-display text-[15px] font-semibold tracking-tight">
              <span className="brand-mark h-8 w-8">
                <ShieldCheck className="h-4 w-4" />
              </span>
              {BRAND.name}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={toAuth}>
                Sign in
              </Button>
              <Button size="sm" className="btn-sheen pressable rounded-lg" onClick={toAuth}>
                Get started
              </Button>
            </div>
          </header>

          {/* hero copy up top; the scene breathes in the band below it
              (Kage's top → spacer → foot column) */}
          <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pt-[6vh]">
            <div className="animate-fade-in-up text-center">
              <p className="console-eyebrow mb-3 text-primary">Safety intelligence for any site</p>
              <h1 className="display-hero" style={{ textShadow: "0 2px 26px rgba(2,6,12,0.9)" }}>
                What happened on <span className="text-gradient-brand">site</span>?
              </h1>
              <p
                className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base"
                style={{ textShadow: "0 1px 18px rgba(2,6,12,0.85)" }}
              >
                Point a camera at the work area, or just describe what happened. The lens sweeping
                this page is what the system sees — drag it.
              </p>
            </div>
          </div>

          {/* the spacer IS the demo: the lens dwells on the forklift here */}
          <div className="min-h-[42vh] flex-1 sm:min-h-[16vh]" />

          {/* hero foot: the composer, centred, riding its own soft scrim */}
          <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-2">
            <div
              aria-hidden
              className="absolute -inset-x-16 -inset-y-8 -z-10"
              style={{
                background:
                  "radial-gradient(88% 84% at 50% 55%, hsl(var(--background) / 0.72), hsl(var(--background) / 0.42) 58%, transparent 82%)",
              }}
            />
            <div
              className="pointer-events-auto animate-fade-in-up"
              style={{ animationDelay: "70ms" }}
            >
              <HomeComposer
                onRequireAuth={toAuth}
                activeConversationId={activeConversationId}
                onConversationChange={setActiveConversationId}
              />
            </div>
            <p
              className="animate-fade-in-up mt-3 text-center text-[11px] text-muted-foreground"
              style={{ animationDelay: "140ms", textShadow: "0 1px 14px rgba(2,6,12,0.9)" }}
            >
              {isAnonymous
                ? `${credits} free draft${credits === 1 ? "" : "s"} left · your conversations are saved — create an account to keep them and unlock live monitoring.`
                : "Describe a hazard to draft a report — no sign-in needed to start. Live monitoring needs an account."}
            </p>
            {/* Honesty rule: the scene is authored, and says so on its face. */}
            <p
              className="mt-1.5 text-center text-[11px] text-muted-foreground/80"
              style={{ textShadow: "0 1px 14px rgba(2,6,12,0.9)" }}
            >
              Illustrated example — the same lens runs on your live camera.
            </p>

            <div className="pointer-events-auto">
              <ConversationThread conversationId={activeConversationId} />
            </div>
          </div>

          {/* floating stats over the scene (Sylva), desktop only */}
          <dl className="absolute bottom-[22%] left-8 z-10 hidden space-y-5 xl:block">
            {[
              ["~2s per frame", "on-device detection"],
              ["5×5 matrix", "every score human-approved"],
            ].map(([dd, dt]) => (
              <div key={dd} style={{ textShadow: "0 2px 16px rgba(2,6,12,0.85)" }}>
                <dd className="text-sm font-semibold">{dd}</dd>
                <dt className="text-xs text-muted-foreground">{dt}</dt>
              </div>
            ))}
          </dl>

          {/* ghost wordmark (Sylva) */}
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-[0.1em] left-3 z-0 hidden select-none whitespace-nowrap font-display text-[10.5vw] font-semibold leading-none tracking-[0.1em] text-foreground/[0.035] lg:block"
          >
            {BRAND.name}
          </span>

          {/* scroll cue (Kage) */}
          <div className="relative z-10 mb-5 flex items-center justify-center gap-3">
            <span
              className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
              style={{ textShadow: "0 1px 12px rgba(2,6,12,0.9)" }}
            >
              See how it works
            </span>
            <span className="relative h-px w-14 overflow-hidden bg-white/15">
              <i className="absolute inset-0 origin-left bg-foreground/70 motion-safe:animate-[hero-cue_2.6s_cubic-bezier(0.65,0,0.35,1)_infinite]" />
            </span>
          </div>
        </section>

        {/* Below the fold: history + the three cards, scrolling over the fixed
            scene on a scrim that fades in (Kage's section treatment). */}
        <section
          className="pointer-events-auto relative"
          style={{
            background:
              "linear-gradient(180deg, transparent, hsl(var(--background) / 0.9) 140px, hsl(var(--background)) 320px)",
          }}
        >
          <div className="mx-auto w-full max-w-2xl px-4 pb-4 pt-24">
            <ConversationHistory
              activeConversationId={activeConversationId}
              onSelect={setActiveConversationId}
              onNew={() => setActiveConversationId(null)}
            />
            <PublicPoints />
          </div>
          <footer className="px-5 py-6 text-center text-[11px] text-muted-foreground">
            {BRAND.name} · {BRAND.tagline.toLowerCase()}
          </footer>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** "/" — one door for everyone. Signed-out visitors get the public landing
 *  (hero + gated composer); signed-in users get the working home. The route
 *  itself is public; every other tab stays behind ProtectedRoute. */
export default function Home() {
  const { isAuthed, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Only real (non-anonymous) accounts get the app shell. Signed-out visitors AND
  // anonymous guests get the public chat surface — guests can draft reports and
  // keep conversations there, but never reach the protected monitoring tabs.
  return isAuthed ? <AuthedHome /> : <PublicHome />;
}
