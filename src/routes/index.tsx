import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { readFlag } from "@/lib/featureFlags";
import Live from "@/pages/Live";
import Home from "@/pages/Home";

/** The front door. Flag-gated so nothing changes until it is flipped on:
 *  - VITE_HOME_COMPOSER off (default): "/" renders the Live camera exactly as
 *    it always has.
 *  - VITE_HOME_COMPOSER on: "/" becomes the multimodal report composer (text ·
 *    photo → agent draft → human review) and the camera lives at /live. */
export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>{readFlag("VITE_HOME_COMPOSER") ? <Home /> : <Live />}</AppLayout>
    </ProtectedRoute>
  ),
});
