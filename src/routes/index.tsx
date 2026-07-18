import { createFileRoute } from "@tanstack/react-router";
import Home from "@/pages/Home";

/** The front door — PUBLIC, the way lovable.dev works. Signed-out visitors land
 *  directly on the hero + gated composer (Home's public variant, no app chrome);
 *  signed-in users get the working home inside the app shell. Home owns the
 *  single auth/loading branch + shell wrapping — the route just renders it.
 *  Every other tab remains behind ProtectedRoute. */
export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});
