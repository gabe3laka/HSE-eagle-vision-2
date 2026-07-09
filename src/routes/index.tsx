import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import Home from "@/pages/Home";

/** The front door — PUBLIC, the way lovable.dev works. Signed-out visitors land
 *  directly on the hero + gated composer (Home renders its public variant, no
 *  app chrome); signed-in users get the working home inside the app shell.
 *  Every other tab remains behind ProtectedRoute. */
export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRoute,
});

function IndexRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return user ? (
    <AppLayout>
      <Home />
    </AppLayout>
  ) : (
    <Home />
  );
}
