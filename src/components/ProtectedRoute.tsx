import { ReactNode } from "react";
import { Navigate } from "@/lib/router-shim";
import { useAuth } from "@/contexts/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    // Home IS the public landing now — send signed-out visitors to the front
    // door (hero + gated composer + sign-in), not a separate marketing page.
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
