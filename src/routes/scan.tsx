import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import ScanPage from "@/features/site-scan/components/ScanPage";

/** In-app Site / Object scan (feature-flagged: VITE_SITE_SCAN_ENABLED).
 *  A sibling of Live — Live (and its monitoring loop + camera) unmounts before
 *  this route renders, so scanning only ever runs with monitoring stopped. */
export const Route = createFileRoute("/scan")({
  ssr: false,
  component: () => (
    <ProtectedRoute>
      <AppLayout>
        <ScanPage />
      </AppLayout>
    </ProtectedRoute>
  ),
});
