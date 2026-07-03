import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Home from "@/pages/Home";

/** The front door. Home composer is always on: "/" renders the multimodal
 *  report composer (text · photo → agent draft → human review) and the live
 *  camera lives at /live. */
export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <Home />
      </AppLayout>
    </ProtectedRoute>
  ),
});
