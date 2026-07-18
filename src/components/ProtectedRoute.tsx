import { ReactNode } from "react";
import { Navigate } from "@/lib/router-shim";
import { useAuth } from "@/contexts/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthed, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthed) {
    // Only a real (non-anonymous) account may reach protected monitoring. Both
    // signed-out visitors AND anonymous guests are sent to the public front door
    // ("/" — hero + composer + sign-in); guests can chat there but never enter
    // Live/Incidents/Safety or perform protected actions.
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
