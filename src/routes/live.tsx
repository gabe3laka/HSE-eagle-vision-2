import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Live, { type AppMode } from "@/pages/Live";

/** The camera door. Accepts ?mode=hse|build|plan (default hse) so the Home
 *  composer's mode selector can deep-link straight into a workflow. Camera
 *  behavior itself is unchanged — the param only seeds Live's initial mode.
 *  (Previously this route redirected to "/", which rendered the same <Live />,
 *  so rendering it here directly is behavior-neutral.) */
const VALID_MODES: readonly AppMode[] = ["hse", "build", "plan"] as const;

export const Route = createFileRoute("/live")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode: AppMode } => {
    const raw = typeof search.mode === "string" ? search.mode : "hse";
    return { mode: (VALID_MODES as readonly string[]).includes(raw) ? (raw as AppMode) : "hse" };
  },
  component: LiveRoute,
});

function LiveRoute() {
  const { mode } = Route.useSearch();
  return (
    <ProtectedRoute>
      <AppLayout>
        {/* key remounts Live when the mode deep-link changes, re-seeding state. */}
        <Live key={mode} initialMode={mode} />
      </AppLayout>
    </ProtectedRoute>
  );
}
