import { useEffect, useState } from "react";
import { Lock, Save, ShieldCheck } from "lucide-react";
import { useAlertSettings, DEFAULT_ALERT_CONFIG, type AlertConfig } from "@/hooks/useAlertSettings";
import { ALL_HAZARDS, HAZARDS } from "@/lib/detection/hazardCatalog";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { HazardType, DetectionMode } from "@/lib/detection/types";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "bn", label: "Bengali" },
  { code: "ne", label: "Nepali" },
  { code: "ml", label: "Malayalam" },
  { code: "ta", label: "Tamil" },
  { code: "tl", label: "Tagalog" },
];

export default function Settings() {
  const { config, setConfig } = useAlertSettings();
  const [draft, setDraft] = useState<AlertConfig>(DEFAULT_ALERT_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const toggleHazard = (h: HazardType) => {
    setDraft((d) => ({
      ...d,
      enabledHazards: d.enabledHazards.includes(h)
        ? d.enabledHazards.filter((x) => x !== h)
        : [...d.enabledHazards, h],
    }));
  };

  const save = async () => {
    setSaving(true);
    await setConfig(draft);
    setSaving(false);
    toast({ title: "Settings saved", description: "Your detection preferences were updated." });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Tune which hazards SafeLens watches for and how sensitive the alerts are.
        </p>
      </header>

      {/* Detection engine */}
      <section className="glass-panel rounded-2xl border p-5">
        <h2 className="font-display text-sm font-semibold">Detection engine</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Four modes: Simulated drives the demo. Pose (beta) uses your camera with MediaPipe to
          detect real unsafe lifting on-device. EdgeCrafter backend (dry run) runs object detection
          + pose on a backend over HTTP and previews boxes/skeletons in a dry-run overlay only.
          EdgeCrafter stream (beta) does the same over a real-time WebSocket when a stream gateway
          is configured.
        </p>
        <Select
          value={draft.detectionMode}
          onValueChange={(v) => setDraft((d) => ({ ...d, detectionMode: v as DetectionMode }))}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simulated">Simulated</SelectItem>
            <SelectItem value="pose-beta">Pose — unsafe lifting (beta)</SelectItem>
            <SelectItem value="backend-deimv2">EdgeCrafter backend — dry run</SelectItem>
            <SelectItem value="backend-edgecrafter-stream">EdgeCrafter stream — beta</SelectItem>
          </SelectContent>
        </Select>
        {draft.detectionMode === "pose-beta" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Beta: detects unsafe lifting only — other hazards stay simulated for now. Loads a small
            model on first start (needs network).
          </p>
        )}
        {draft.detectionMode === "backend-deimv2" && (
          <p className="mt-2 text-xs text-muted-foreground">
            EdgeCrafter backend via RunPod. Previews object boxes and pose skeletons in a dry-run
            overlay only — no safety alerts fire yet (Sprint 4A dry-run).
          </p>
        )}
        {draft.detectionMode === "backend-edgecrafter-stream" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Beta: streams camera frames to the EdgeCrafter worker over a WebSocket and previews
            boxes/skeletons in real time — dry-run overlay only, no safety alerts. Authenticated
            with a short-lived Supabase session token; the gateway URL is provided by the session,
            so no build-time URL is required. The browser never holds the RunPod API key.
          </p>
        )}
      </section>

      {/* Detections */}
      <section className="glass-panel rounded-2xl border p-5">
        <h2 className="font-display text-sm font-semibold">Detections</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Five precise detections beat fifty noisy ones. Turn off what doesn't apply to your site.
        </p>
        <div className="divide-y divide-border/60">
          {ALL_HAZARDS.map((h) => {
            const Icon = HAZARD_ICONS[h];
            const enabled = draft.enabledHazards.includes(h);
            return (
              <div key={h} className="flex items-center gap-3 py-3">
                <span className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{HAZARDS[h].label}</p>
                  <p className="text-xs text-muted-foreground">{HAZARDS[h].message}</p>
                </div>
                <Switch checked={enabled} onCheckedChange={() => toggleHazard(h)} />
              </div>
            );
          })}
        </div>
      </section>

      {/* Sensitivity + language */}
      <section className="glass-panel space-y-5 rounded-2xl border p-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Alert sensitivity</Label>
            <span className="text-sm font-medium text-primary">
              {Math.round(draft.sensitivity * 100)}%
            </span>
          </div>
          <Slider
            value={[Math.round(draft.sensitivity * 100)]}
            min={5}
            max={100}
            step={5}
            onValueChange={([v]) => setDraft((d) => ({ ...d, sensitivity: v / 100 }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Higher sensitivity surfaces more events. Lower it if you're seeing false alarms.
          </p>
        </div>

        <div>
          <Label className="mb-2 block">Alert language</Label>
          <Select
            value={draft.language}
            onValueChange={(language) => setDraft((d) => ({ ...d, language }))}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            Alerts use a coaching tone in the worker's own language.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          <div className="pr-4">
            <Label>Browser notifications</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Pop a notification for high &amp; critical hazards — the Plan A "supervisor alert".
            </p>
          </div>
          <Switch
            checked={draft.notificationsEnabled}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, notificationsEnabled: v }))}
          />
        </div>
      </section>

      {/* Consent & privacy */}
      <section className="glass-panel rounded-2xl border p-5">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Lock className="h-4 w-4 text-primary" /> Consent &amp; privacy
        </h2>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Monitoring is for safety coaching only. The live feed is processed on-device and is not
            stored.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Only high and critical incidents are recorded with the time and date, kept private to
            your account.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Inform workers and obtain written consent before monitoring, and display clear signage —
            in line with UAE PDPL.
          </li>
        </ul>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} size="lg">
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
