import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import Home from "@/pages/Home";

/** The front door. Home composer is always on and PUBLIC — "/" renders the
 *  multimodal report composer for signed-in and signed-out visitors alike.
 *  Signed-out users can compose freely; submitting prompts sign-in via /auth.
 *  The live camera lives at /live (still protected). */
export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <AppLayout>
      <Home />
    </AppLayout>
  ),
});
