import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { HomeComposer } from "@/features/report-composer/HomeComposer";
import { RecentDrafts } from "@/features/report-composer/RecentDrafts";

/**
 * The SafeLens front door. A calm, single input surface that matches the
 * product's identity — a vision that reasons AND an agent you talk to. Typing
 * or attaching a photo drafts a safety report; the mode selector jumps into
 * the live camera at /live. Mobile-first, centered, matching the app theme.
 */

export default function Home() {
  const { profile } = useAuth();
  const name = profile?.full_name?.split(" ")[0] || null;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col justify-center px-1 py-6">
      <div className="mb-6 text-center">
        <span className="brand-mark mx-auto mb-4 flex h-11 w-11 items-center justify-center">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {name ? `What happened, ${name}?` : "What happened on site?"}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Describe a hazard or near-miss and the agent drafts a safety report for you to review — or
          pick a mode to open the live camera.
        </p>
      </div>

      <HomeComposer />

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        Nothing is filed automatically — every report is yours to review, edit, and approve.
      </p>

      <RecentDrafts />
    </div>
  );
}
