import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Safety from "@/pages/Safety";

// The former Overview is now the Safety Management hub (nav label "Safety").
// Route path stays /overview so existing links keep working.
export const Route = createFileRoute("/overview")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <Safety />
      </AppLayout>
    </ProtectedRoute>
  ),
});
