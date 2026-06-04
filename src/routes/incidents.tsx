import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Incidents from "@/pages/Incidents";

export const Route = createFileRoute("/incidents")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <Incidents />
      </AppLayout>
    </ProtectedRoute>
  ),
});
