import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import ReportDraftReview from "@/pages/ReportDraftReview";

/** Human review / approve / file surface for an agent report draft. Part of the
 *  Home composer flow; reachable directly by URL (drafts are owner-RLS'd). */
export const Route = createFileRoute("/report/$id")({
  ssr: false,
  component: ReportRoute,
});

function ReportRoute() {
  const { id } = Route.useParams();
  return (
    <ProtectedRoute>
      <AppLayout>
        <ReportDraftReview id={id} />
      </AppLayout>
    </ProtectedRoute>
  );
}
