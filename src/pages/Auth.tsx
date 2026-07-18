import { useState } from "react";
import { useNavigate } from "@/lib/router-shim";
import { Camera, Hammer, Route, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

const GUEST_ID_KEY = "safelens.guestId";

function readGuestId(): string | null {
  try {
    return localStorage.getItem(GUEST_ID_KEY);
  } catch {
    return null;
  }
}
function clearGuestId() {
  try {
    localStorage.removeItem(GUEST_ID_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { isAnonymous } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const guestId = readGuestId();

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Signing into an EXISTING account from a guest session: move the guest's
        // conversations + drafts into this account (best-effort; the RPC only
        // ever moves rows FROM a still-anonymous guest TO the caller).
        if (guestId) {
          try {
            await supabase.rpc("claim_guest_data", { p_guest: guestId });
          } catch {
            /* nothing to claim / already merged — non-fatal */
          }
          clearGuestId();
        }
        navigate("/");
      } else if (isAnonymous) {
        // Guest creating an account: CONVERT the anonymous user into a permanent
        // one. Same user_id → every conversation, draft and attachment is retained
        // automatically with its original timestamps (no data migration).
        const { error } = await supabase.auth.updateUser({
          email,
          password,
          data: { full_name: fullName },
        });
        if (error) throw error;
        clearGuestId();
        toast({
          title: "Account created",
          description: "Confirm your email to finish — your conversations are already saved.",
        });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast({
          title: "Account created",
          description: "Check your email to confirm your account, then sign in.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="console-canvas flex min-h-screen items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-border bg-card shadow-[var(--shadow-overlay)] lg:grid-cols-[1.05fr_0.95fr]">
        <aside className="relative hidden overflow-hidden border-r border-border p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="brand-mark">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </span>
              <div>
                <p className="font-display text-xl font-semibold">SafeLens</p>
                <p className="console-eyebrow">Operator console</p>
              </div>
            </div>
            <h2 className="mt-16 max-w-md font-display text-4xl font-semibold leading-tight">
              One camera workspace for safer, clearer field work.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Monitor hazards, capture repeatable procedures, and generate guided AR plans without
              leaving the live view.
            </p>
          </div>
          <div className="relative grid grid-cols-3 gap-3">
            {[
              { icon: Camera, label: "Monitor" },
              { icon: Hammer, label: "Build" },
              { icon: Route, label: "Plan" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-xl border border-border bg-secondary/40 p-3">
                <Icon className="h-4 w-4 text-primary" />
                <p className="mt-2 text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>
        </aside>

        <div className="relative w-full animate-fade-in p-6 sm:p-10">
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <span className="brand-mark lg:hidden">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </span>
              <h1 className="font-display text-3xl font-semibold text-foreground">
                {isLogin ? "Welcome back" : "Create your account"}
              </h1>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? "Sign in to start monitoring" : "Create your safety account"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Site"
                  required={!isLogin}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="min-h-11 w-full rounded-xl" disabled={loading}>
              {loading ? "Loading..." : isLogin ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
