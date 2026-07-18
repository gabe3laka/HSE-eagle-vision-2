import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/own-client";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  preferred_language: string;
  ai_credits: number;
}

const GUEST_ID_KEY = "safelens.guestId";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  /** True for a Supabase anonymous session (guest) — NOT a fully signed-in user. */
  isAnonymous: boolean;
  /** True only for a real, non-anonymous account. Gate protected actions on this. */
  isAuthed: boolean;
  /** Remaining guest AI credits (from the profile; unlimited-in-practice once signed in). */
  credits: number;
  /** Start (or reuse) an anonymous guest session. Returns false if anon sign-in
   *  is disabled in the project (Auth settings) or otherwise fails. */
  signInAnonymously: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  profile: null,
  isAnonymous: false,
  isAuthed: false,
  credits: 0,
  signInAnonymously: async () => false,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function readIsAnonymous(user: User | null): boolean {
  // Supabase marks guest sessions with is_anonymous on the user + JWT claims.
  return Boolean(
    user &&
    ((user as unknown as { is_anonymous?: boolean }).is_anonymous ||
      user.app_metadata?.provider === "anonymous"),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // defer to avoid deadlocks inside the auth callback
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, preferred_language, ai_credits")
        .eq("user_id", userId)
        .maybeSingle();
      setProfile((data as Profile) ?? null);
    } catch (e) {
      console.error("Error fetching profile:", e);
    } finally {
      setLoading(false);
    }
  }

  const signInAnonymously = async (): Promise<boolean> => {
    // Already have any session? reuse it (a guest keeps their thread across refresh).
    if (session?.user) return true;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      // Anonymous sign-ins disabled in project settings (or transient failure) —
      // caller falls back to the normal sign-in prompt.
      console.warn("Anonymous sign-in unavailable:", error?.message);
      return false;
    }
    try {
      localStorage.setItem(GUEST_ID_KEY, data.user.id);
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
    return true;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const isAnonymous = readIsAnonymous(user);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        profile,
        isAnonymous,
        isAuthed: Boolean(user) && !isAnonymous,
        credits: profile?.ai_credits ?? 0,
        signInAnonymously,
        signOut,
        refreshProfile: () => (user ? fetchProfile(user.id) : Promise.resolve()),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
