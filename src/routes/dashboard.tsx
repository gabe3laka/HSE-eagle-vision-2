import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: () => <Navigate to="/overview" replace />,
});
