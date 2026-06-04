import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/live")({
  ssr: false,
  component: () => <Navigate to="/" replace />,
});
