import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Overview from "@/pages/Overview";

export const Route = createFileRoute("/overview")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <Overview />
      </AppLayout>
    </ProtectedRoute>
  ),
});
