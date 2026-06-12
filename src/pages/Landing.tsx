import { Link } from "@/lib/router-shim";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Camera,
  EyeOff,
  Hammer,
  Languages,
  Radar,
  Route,
  ShieldCheck,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Camera,
    title: "Your phone is the camera",
    description:
      "Point the rear camera at the work area. SafeLens watches the live stream for hazards in real time — no extra hardware.",
  },
  {
    icon: Zap,
    title: "Instant, tiered alerts",
    description:
      "A held bad lift becomes a flag; a forklift on a collision path fires immediately. Precision tuned to avoid false alarms.",
  },
  {
    icon: EyeOff,
    title: "Private by design",
    description:
      "Detection runs on-device. Nothing is recorded unless a real incident is saved — built for UAE PDPL from day one.",
  },
];

const detections = [
  "Unsafe lifting",
  "Forklift proximity",
  "Blocked fire exit",
  "Restricted-zone entry",
  "PPE compliance",
];

export default function Landing() {
  return (
    <div className="console-canvas relative min-h-screen overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[900px] w-[1200px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(16,185,129,0.3),transparent_60%)]" />
        <div className="absolute left-1/2 top-[10%] h-[400px] w-[600px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(16,185,129,0.2),transparent_50%)]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <span className="brand-mark h-9 w-9">
            <ShieldCheck className="h-4 w-4 text-slate-950" />
          </span>
          SafeLens
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">Sign In</Link>
          </Button>
          <Button size="sm" variant="gradient" className="min-h-[44px]" asChild>
            <Link to="/auth">Get Started</Link>
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-5 pb-24 pt-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:pt-20">
        <div>
          <div className="mb-8 inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-primary/50 bg-primary/5 px-4 py-1.5 text-sm text-primary shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Real-time safety coaching
          </div>

          <h1
            className="display-text mb-6 max-w-3xl animate-fade-in-up"
            style={{ animationDelay: "0.1s" }}
          >
            See the hazard
            <br className="hidden sm:block" /> before it happens
          </h1>

          <p
            className="mb-10 max-w-xl animate-fade-in-up text-lg text-muted-foreground"
            style={{ animationDelay: "0.2s" }}
          >
            SafeLens Vision turns a phone or existing camera into a real-time safety coach —
            spotting unsafe actions and dangers on the live feed and alerting workers the instant
            they matter.
          </p>

          <div
            className="mb-6 flex animate-fade-in-up flex-wrap items-center gap-3"
            style={{ animationDelay: "0.3s" }}
          >
            <Button
              size="lg"
              variant="gradient"
              className="min-h-[44px] animate-glow-pulse"
              asChild
            >
              <Link to="/auth">
                Start monitoring
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="glass" size="lg" className="min-h-[44px]" asChild>
              <Link to="/auth">Watch live demo</Link>
            </Button>
          </div>

          <div
            className="flex animate-fade-in-up flex-wrap items-center gap-x-6 gap-y-2"
            style={{ animationDelay: "0.45s" }}
          >
            {detections.map((name) => (
              <span
                key={name}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        <div className="console-panel relative animate-fade-in-up overflow-hidden p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="console-eyebrow">Live operator workspace</p>
              <p className="mt-1 font-display text-sm font-semibold">Eagle Vision</p>
            </div>
            <span className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
              Monitoring
            </span>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] border border-cyan-200/10 bg-[radial-gradient(circle_at_45%_35%,rgba(34,211,238,0.13),transparent_24%),linear-gradient(145deg,#111b2c,#050a12)]">
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(103,232,249,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,.18)_1px,transparent_1px)] [background-size:32px_32px]" />
            <div className="absolute left-[14%] top-[20%] h-[48%] w-[28%] rounded-lg border border-cyan-300/70">
              <span className="absolute -top-6 left-0 rounded bg-cyan-300 px-2 py-1 text-[9px] font-bold text-slate-950">
                PERSON
              </span>
            </div>
            <div className="absolute right-[12%] top-[38%] h-[26%] w-[34%] rounded-lg border border-amber-300/80">
              <span className="absolute -top-6 right-0 rounded bg-amber-300 px-2 py-1 text-[9px] font-bold text-slate-950">
                WORK ZONE
              </span>
            </div>
            <div className="absolute inset-x-0 top-1/3 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent shadow-[0_0_14px_rgba(34,211,238,.8)]" />
            <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/5 bg-black/50 p-3 backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                Scene clear
              </p>
              <p className="mt-1 text-xs text-slate-300">
                Two stable tracks. No immediate safety action required.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { icon: Radar, label: "Monitor", tone: "text-cyan-200" },
              { icon: Hammer, label: "Build", tone: "text-emerald-200" },
              { icon: Route, label: "Plan", tone: "text-violet-200" },
            ].map(({ icon: Icon, label, tone }) => (
              <div key={label} className="metric-card flex items-center gap-2 p-3">
                <Icon className={`h-4 w-4 ${tone}`} />
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="mb-12 text-center">
          <h2 className="mb-3 font-display text-2xl font-bold">
            A safety layer, not another gadget
          </h2>
          <p className="text-muted-foreground">
            Five precise detections, multilingual coaching, and an alert that lands in under a
            second.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className="console-panel animate-fade-in-up p-8 transition-transform hover:-translate-y-1"
              style={{ animationDelay: `${0.15 * i}s` }}
            >
              <div className="mb-4 w-fit rounded-lg bg-primary/20 p-3">
                <feature.icon className="h-5 w-5 text-primary drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]" />
              </div>
              <h3 className="mb-2 font-display text-lg font-semibold">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Languages className="h-4 w-4 text-primary" />
          Alerts in English, Arabic, Hindi, Urdu, Bengali, Nepali, Malayalam, Tamil &amp; Tagalog
        </div>
      </section>

      {/* CTA Footer */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-24">
        <div className="glass-gradient relative rounded-2xl p-10 text-center">
          <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse,rgba(16,185,129,0.15),transparent_60%)]" />
          <h2 className="relative z-10 mb-3 font-display text-2xl font-bold">
            Turn any camera into a safety coach
          </h2>
          <p className="relative z-10 mb-6 text-muted-foreground">
            Start with the phone in your pocket. Scale to the cameras on your wall.
          </p>
          <Button size="lg" variant="gradient" className="relative z-10 min-h-[44px]" asChild>
            <Link to="/auth">Start monitoring</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 py-8 text-center">
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} SafeLens Vision</span>
          <span>Privacy</span>
          <span>Safety</span>
          <span>Contact</span>
        </div>
      </footer>
    </div>
  );
}
