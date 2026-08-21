import { useMemo, useState } from "react";
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
    title: "Your phone is the camera",
    text: "Point it at the work area — hazards are flagged in real time, no extra hardware.",
  },
  {
    icon: Zap,
    title: "Report by just describing it",
    text: "Type or photograph what happened; the agent drafts the safety report for your review.",
  },
  {
    icon: EyeOff,
    title: "Private by design",
    text: "Detection runs live; nothing is filed without a human approving it.",
  },
];

/** The public front door — visitor lands directly on the product's input, the
 *  way lovable.dev works: one hero line, the composer (visible but gated), and
 *  Sign in in the corner. Replaces the old standalone /landing page. */
function PublicHome() {
  const navigate = useNavigate();
  const toAuth = () => navigate("/auth");
  const { isAnonymous, credits } = useAuth();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Minimal top bar: brand + sign in */}
      <header
        className="flex items-center justify-between px-5 py-4 sm:px-8"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <span className="flex items-center gap-2.5 font-display text-[15px] font-semibold tracking-tight">
          <span className="brand-mark h-8 w-8">
            <ShieldCheck className="h-4 w-4" />
          </span>
          SafeLens
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

      {/* Hero + gated composer */}
      <main className="mesh-hero mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
        <div className="animate-fade-in-up mb-7 text-center">
          <p className="console-eyebrow mb-3 text-primary">Safety intelligence for any site</p>
          <h1 className="display-hero">
            What happened on <span className="text-gradient-brand">site</span>?
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            SafeLens turns any camera into live risk intelligence — and a photo or a sentence into a
            filed safety report. Describe it below to see how.
          </p>
        </div>

        <div className="animate-fade-in-up" style={{ animationDelay: "70ms" }}>
          <HomeComposer
            onRequireAuth={toAuth}
            activeConversationId={activeConversationId}
            onConversationChange={setActiveConversationId}
          />
        </div>
        <p
          className="animate-fade-in-up mt-3 text-center text-[11px] text-muted-foreground"
          style={{ animationDelay: "140ms" }}
        >
          {isAnonymous
            ? `${credits} free draft${credits === 1 ? "" : "s"} left · your conversations are saved — create an account to keep them and unlock live monitoring.`
            : "Describe a hazard to draft a report — no sign-in needed to start. Live monitoring needs an account."}
        </p>

        <ConversationThread conversationId={activeConversationId} />

        <div className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <ConversationHistory
            activeConversationId={activeConversationId}
            onSelect={setActiveConversationId}
            onNew={() => setActiveConversationId(null)}
          />

          {/* Three-point product summary (folded in from the old /landing) */}
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {PUBLIC_POINTS.map((p) => (
              <div key={p.title} className="console-panel hover-lift rounded-xl p-5">
                <span className="glyph-halo mb-3 h-10 w-10">
                  <p.icon className="h-4.5 w-4.5 text-primary" />
                </span>
                <h3 className="mt-2.5 text-sm font-semibold">{p.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-5 py-6 text-center text-[11px] text-muted-foreground">
        SafeLens · live HSE monitoring & agentic safety reporting
      </footer>
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
