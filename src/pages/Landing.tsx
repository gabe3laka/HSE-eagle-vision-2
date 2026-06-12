import { Link } from "@/lib/router-shim";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Camera,
  EyeOff,
  Languages,
  ShieldCheck,
  Zap,
} from "lucide-react";

const detections = [
  "Unsafe Lifting",
  "Forklift Proximity",
  "Blocked Fire Exit",
  "Restricted-Zone Entry",
  "PPE Compliance",
];

const features = [
  {
    n: "01",
    icon: Camera,
    title: "Your phone is the camera",
    description:
      "Point the rear camera at the work area. SafeLens watches the live stream for hazards in real time — no extra hardware.",
  },
  {
    n: "02",
    icon: Zap,
    title: "Instant, tiered alerts",
    description:
      "A held bad lift becomes a flag; a forklift on a collision path fires immediately. Precision tuned to avoid false alarms.",
  },
  {
    n: "03",
    icon: EyeOff,
    title: "Private by design",
    description:
      "Detection runs on-device. Nothing is recorded unless a real incident is saved — built for UAE PDPL from day one.",
  },
];

export default function Landing() {
  return (
    <div
      className="min-h-screen w-full bg-[#020617] text-slate-50 antialiased selection:bg-cyan-500/30"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes personSearch {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(40px, 20px); }
          50% { transform: translate(-20px, 40px); }
          75% { transform: translate(60px, -10px); }
        }
        @keyframes skeletonAppear {
          0%, 45%, 55%, 100% { opacity: 0; transform: scale(0.95); }
          48%, 52% { opacity: 1; transform: scale(1); }
        }
        @keyframes scanMove {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(900%); }
        }
        .sl-search { animation: personSearch 8s ease-in-out infinite; }
        .sl-skeleton { animation: skeletonAppear 8s ease-in-out infinite; }
        .sl-scanline {
          position: absolute; top: 0; left: 0;
          width: 100%; height: 40px; pointer-events: none;
          background: linear-gradient(0deg, rgba(34,211,238,0.12) 0%, rgba(34,211,238,0) 100%);
          border-bottom: 1px solid rgba(34,211,238,0.35);
          animation: scanMove 4s linear infinite;
        }
        .sl-display { font-family: 'Space Grotesk', system-ui, sans-serif; }
      `}</style>

      {/* Nav */}
      <nav className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#020617]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="SafeLens home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/40">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
            </span>
            <span className="sl-display text-lg font-semibold tracking-tight text-white">
              SafeLens
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white" asChild>
              <Link to="/auth">Sign In</Link>
            </Button>
            <Button
              size="sm"
              className="min-h-[40px] rounded-full bg-cyan-400 px-5 text-[#020617] hover:bg-cyan-300 border-cyan-300/40"
              asChild
            >
              <Link to="/auth">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-32 top-32 h-[500px] w-[500px] rounded-full bg-cyan-900/30 blur-[140px]" />
        <div className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-teal-900/20 blur-[120px]" />

        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-6 py-20 lg:grid-cols-2 lg:py-28">
          {/* Left */}
          <div className="relative z-10 space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Real-time safety coaching
            </div>

            <h1 className="sl-display text-5xl font-light leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
              See the hazard
              <br />
              <span className="bg-gradient-to-r from-cyan-300 to-teal-200 bg-clip-text text-transparent">
                before it happens
              </span>
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-slate-400">
              SafeLens Vision turns a phone or existing camera into a real-time safety coach —
              spotting unsafe actions and dangers on the live feed and alerting workers the instant
              they matter.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="group min-h-[48px] rounded-lg bg-cyan-400 px-7 text-[#020617] shadow-[0_0_30px_rgba(34,211,238,0.18)] hover:bg-cyan-300 border-cyan-300/40"
                asChild
              >
                <Link to="/auth">
                  Start monitoring
                  <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="min-h-[48px] rounded-lg border-white/10 bg-white/5 px-7 text-white hover:bg-white/10"
                asChild
              >
                <Link to="/auth">Watch live demo</Link>
              </Button>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {detections.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>

          {/* Right — Camera mock */}
          <div className="relative">
            <div className="pointer-events-none absolute -inset-16 bg-cyan-500/10 opacity-40 blur-[120px]" />

            <div className="relative rounded-2xl border border-white/10 bg-white/[0.02] p-1 shadow-2xl backdrop-blur-3xl">
              <div className="overflow-hidden rounded-xl bg-[#080d12]/90 shadow-inner">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      Live Operator Workspace
                    </p>
                    <h3 className="sl-display text-xs font-semibold tracking-wide text-white">
                      CAM-04-NORTH_DOCK
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/20">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-300">
                      Live Feed
                    </span>
                  </div>
                </div>

                {/* Viewport */}
                <div className="relative aspect-video w-full overflow-hidden bg-[#0a0f16]">
                  <div className="sl-scanline" />
                  <div
                    className="absolute inset-0 opacity-10"
                    style={{
                      backgroundImage:
                        "linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)",
                      backgroundSize: "40px 40px",
                    }}
                  />

                  {/* Static zone */}
                  <div className="absolute left-[40%] top-[35%] h-[40%] w-[25%] rounded-sm border border-dashed border-white/10 bg-white/[0.02]">
                    <div className="absolute -top-4 left-0 text-[7px] font-bold uppercase tracking-[0.25em] text-slate-600">
                      Loading Bay 2
                    </div>
                  </div>

                  {/* Searching bbox + pose */}
                  <div className="sl-search absolute left-[15%] top-[20%] h-[55%] w-[35%] border border-cyan-400/40 bg-cyan-400/5 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                    <div className="absolute -top-5 left-0 bg-cyan-400 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-tighter text-black">
                      Scanning...
                    </div>

                    <div className="sl-skeleton pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="absolute left-1/2 top-3 -translate-x-1/2 bg-cyan-400 px-1.5 py-0.5 text-[7px] font-black tracking-tighter text-black shadow-xl">
                        PERSON DETECTED
                      </div>
                      <svg
                        className="h-[85%] w-auto"
                        viewBox="0 0 100 200"
                        stroke="rgba(34,211,238,0.85)"
                        fill="none"
                      >
                        <g strokeWidth="1" strokeLinecap="round">
                          <line x1="50" y1="30" x2="50" y2="45" />
                          <line x1="40" y1="45" x2="60" y2="45" />
                          <line x1="40" y1="45" x2="43" y2="90" />
                          <line x1="60" y1="45" x2="57" y2="90" />
                          <line x1="43" y1="90" x2="57" y2="90" />
                          <line x1="40" y1="45" x2="28" y2="65" />
                          <line x1="28" y1="65" x2="22" y2="95" />
                          <line x1="60" y1="45" x2="72" y2="65" />
                          <line x1="72" y1="65" x2="78" y2="95" />
                          <line x1="43" y1="90" x2="40" y2="135" />
                          <line x1="40" y1="135" x2="44" y2="175" />
                          <line x1="57" y1="90" x2="60" y2="135" />
                          <line x1="60" y1="135" x2="56" y2="175" />
                        </g>
                        <g fill="#22d3ee">
                          <circle cx="50" cy="22" r="4" strokeWidth="1" />
                          <circle cx="40" cy="45" r="1.5" />
                          <circle cx="60" cy="45" r="1.5" />
                          <circle cx="28" cy="65" r="1.5" />
                          <circle cx="72" cy="65" r="1.5" />
                          <circle cx="22" cy="95" r="1.5" />
                          <circle cx="78" cy="95" r="1.5" />
                          <circle cx="43" cy="90" r="1.5" />
                          <circle cx="57" cy="90" r="1.5" />
                          <circle cx="40" cy="135" r="1.5" />
                          <circle cx="60" cy="135" r="1.5" />
                          <circle cx="44" cy="175" r="1.5" />
                          <circle cx="56" cy="175" r="1.5" />
                        </g>
                      </svg>
                    </div>

                    <div className="absolute left-0 top-0 h-2 w-2 border-l-2 border-t-2 border-cyan-400" />
                    <div className="absolute right-0 top-0 h-2 w-2 border-r-2 border-t-2 border-cyan-400" />
                    <div className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-cyan-400" />
                    <div className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-cyan-400" />
                  </div>

                  <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-1">
                    <div className="animate-pulse rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-300">
                      AI Inference Active
                    </div>
                  </div>
                </div>

                {/* Footer stats */}
                <div className="flex items-center justify-between border-t border-white/5 bg-white/[0.01] px-4 py-3">
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-bold uppercase tracking-tighter text-slate-500">
                        Detection Rate
                      </span>
                      <span className="text-xs font-bold uppercase text-white">99.4%</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-bold uppercase tracking-tighter text-slate-500">
                        Latency
                      </span>
                      <span className="text-xs font-bold uppercase text-cyan-300">24ms</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-700" />
                    <span className="h-2 w-2 rounded-full bg-slate-700" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Floating badges */}
            <div className="absolute -bottom-6 left-6 right-6 flex justify-between">
              <div className="rounded-lg border border-white/10 bg-[#0f172a]/80 px-3 py-2 shadow-xl backdrop-blur-md">
                <p className="text-[8px] font-bold uppercase text-slate-400">Threat Level</p>
                <p className="text-[10px] font-bold uppercase text-emerald-300">Nominal</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#0f172a]/80 px-3 py-2 shadow-xl backdrop-blur-md">
                <p className="text-[8px] font-bold uppercase text-slate-400">Entities</p>
                <p className="text-[10px] font-bold uppercase text-white">01 Active</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-14 max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300/80">
            What it does
          </p>
          <h2 className="sl-display mt-3 text-3xl font-light tracking-tight text-white sm:text-4xl">
            A safety layer, not another gadget.
          </h2>
          <p className="mt-4 text-base text-slate-400">
            Five precise detections, multilingual coaching, and an alert that lands in under a
            second.
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-white/10 border border-white/10 md:grid-cols-3 md:divide-x md:divide-y-0">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative p-10 transition-colors hover:bg-white/[0.02]"
            >
              <div className="mb-8 flex items-center justify-between">
                <span className="sl-display text-2xl font-light text-slate-500 group-hover:text-cyan-300/80">
                  {f.n}
                </span>
                <f.icon className="h-5 w-5 text-cyan-300/80" />
              </div>
              <h3 className="sl-display mb-3 text-lg font-semibold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{f.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-2 text-sm text-slate-500">
          <Languages className="h-4 w-4 text-cyan-300/80" />
          Alerts in English, Arabic, Hindi, Urdu, Bengali, Nepali, Malayalam, Tamil &amp; Tagalog.
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#0a1a2e] via-[#0c2340] to-[#093140] px-8 py-16 sm:px-16 sm:py-20">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-teal-400/10 blur-3xl" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300/80">
                Ship the safety layer
              </p>
              <h2 className="sl-display mt-3 text-3xl font-light leading-tight text-white sm:text-4xl">
                Turn any camera into a safety coach.
              </h2>
              <p className="mt-3 max-w-xl text-slate-300/80">
                Start with the phone in your pocket. Scale to the cameras on your wall.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button
                size="lg"
                className="min-h-[48px] rounded-lg bg-cyan-400 px-7 text-[#020617] hover:bg-cyan-300 border-cyan-300/40"
                asChild
              >
                <Link to="/auth">
                  Start monitoring
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="min-h-[48px] rounded-lg border-white/15 bg-white/5 px-7 text-white hover:bg-white/10"
                asChild
              >
                <Link to="/auth">Sign In</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-cyan-500/10 ring-1 ring-cyan-500/30">
              <ShieldCheck className="h-3 w-3 text-cyan-300" />
            </span>
            <span className="sl-display font-semibold text-slate-300">SafeLens</span>
            <span>© {new Date().getFullYear()} SafeLens Vision</span>
          </div>
          <div className="flex gap-6 font-bold uppercase tracking-[0.2em]">
            <span>Privacy</span>
            <span>Safety</span>
            <span>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
