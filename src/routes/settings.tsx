import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Settings from "@/pages/Settings";

export const Route = createFileRoute("/settings")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <Settings />
      </AppLayout>
    </ProtectedRoute>
  ),
});
