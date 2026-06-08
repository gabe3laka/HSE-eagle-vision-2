import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import { ALL_HAZARDS } from "@/lib/detection/hazardCatalog";
import type { HazardType, DetectionMode } from "@/lib/detection/types";

export interface AlertConfig {
  enabledHazards: HazardType[];
  sensitivity: number; // 0..1
  language: string;
  voiceEnabled: boolean;
  notificationsEnabled: boolean; // browser "supervisor" notifications for high/critical
  detectionMode: DetectionMode;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabledHazards: [...ALL_HAZARDS],
  sensitivity: 0.5,
  language: "en",
  voiceEnabled: false,
  notificationsEnabled: true,
  detectionMode: "simulated",
};

const VALID_MODES: DetectionMode[] = [
  "simulated",
  "pose-beta",
  "backend-edgecrafter-http",
  "backend-deimv2",
  "backend-edgecrafter-stream",
];

// The slow Supabase-proxy HTTP path and the WebSocket stream mode have been
// retired from the UI in favour of the fast Cloudflare `/detect` HTTP mode. Any
// previously-saved value for them migrates to the new mode on load.
const MODE_ALIASES: Record<string, DetectionMode> = {
  "backend-deimv2": "backend-edgecrafter-http",
  "backend-edgecrafter-stream": "backend-edgecrafter-http",
};

function coerceMode(v: unknown): DetectionMode {
  if (typeof v === "string") {
    if (v in MODE_ALIASES) return MODE_ALIASES[v];
    if ((VALID_MODES as string[]).includes(v)) return v as DetectionMode;
  }
  return "simulated";
}

export function useAlertSettings() {
  const { user } = useAuth();
  const [config, setConfigState] = useState<AlertConfig>(DEFAULT_ALERT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("alert_settings")
        .select("config, preferred_language, voice_enabled")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const cfg = (data.config ?? {}) as Partial<AlertConfig>;
        setConfigState({
          enabledHazards: cfg.enabledHazards?.length
            ? cfg.enabledHazards
            : DEFAULT_ALERT_CONFIG.enabledHazards,
          sensitivity:
            typeof cfg.sensitivity === "number"
              ? cfg.sensitivity
              : DEFAULT_ALERT_CONFIG.sensitivity,
          language: data.preferred_language ?? "en",
          voiceEnabled: data.voice_enabled ?? false,
          notificationsEnabled:
            typeof cfg.notificationsEnabled === "boolean"
              ? cfg.notificationsEnabled
              : DEFAULT_ALERT_CONFIG.notificationsEnabled,
          detectionMode: coerceMode(cfg.detectionMode),
        });
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setConfig = useCallback(
    async (next: AlertConfig) => {
      setConfigState(next);
      if (!user) return;
      await supabase.from("alert_settings").upsert(
        {
          owner_id: user.id,
          config: {
            enabledHazards: next.enabledHazards,
            sensitivity: next.sensitivity,
            notificationsEnabled: next.notificationsEnabled,
            detectionMode: next.detectionMode,
          },
          preferred_language: next.language,
          voice_enabled: next.voiceEnabled,
        },
        { onConflict: "owner_id" },
      );
    },
    [user],
  );

  return { config, setConfig, loading };
}
