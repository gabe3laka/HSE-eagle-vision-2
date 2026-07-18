import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-shim";

/** Retired — Home ("/") IS the public landing now (hero + gated composer).
 *  Kept only as a redirect so old links and bookmarks keep working. */
export const Route = createFileRoute("/landing")({
  ssr: false,
  component: () => <Navigate to="/" replace />,
});
