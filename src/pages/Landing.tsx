import { Link } from "@/lib/router-shim";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Camera, Languages, Zap, EyeOff } from "lucide-react";

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
    <div className="mesh-gradient dotted-grid relative min-h-screen overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[900px] w-[1200px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(16,185,129,0.3),transparent_60%)]" />
        <div className="absolute left-1/2 top-[10%] h-[400px] w-[600px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(16,185,129,0.2),transparent_50%)]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Safe<span className="text-primary">Lens</span>
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
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16 text-center">
        <div className="mb-8 inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-primary/50 bg-primary/5 px-4 py-1.5 text-sm text-primary shadow-[0_0_15px_rgba(16,185,129,0.2)]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Real-time safety coaching
        </div>

        <h1
          className="display-text mx-auto mb-6 max-w-3xl animate-fade-in-up"
          style={{ animationDelay: "0.1s" }}
        >
          See the hazard
          <br className="hidden sm:block" /> before it happens
        </h1>

        <p
          className="mx-auto mb-10 max-w-xl animate-fade-in-up text-lg text-muted-foreground"
          style={{ animationDelay: "0.2s" }}
        >
          SafeLens Vision turns a phone or existing camera into a real-time safety coach — spotting
          unsafe actions and dangers on the live feed and alerting workers the instant they matter.
        </p>

        <div
          className="mb-6 flex animate-fade-in-up items-center justify-center gap-4"
          style={{ animationDelay: "0.3s" }}
        >
          <Button size="lg" variant="gradient" className="min-h-[44px] animate-glow-pulse" asChild>
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
          className="flex animate-fade-in-up flex-wrap items-center justify-center gap-x-6 gap-y-2"
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
              className="glass-interactive animate-fade-in-up rounded-xl p-8"
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
