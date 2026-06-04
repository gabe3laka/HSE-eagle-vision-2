// App client pointed at the user's own Supabase project (pigisgebfcbfvvflxkdw).
// URL + anon key are publishable and safe to commit.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pigisgebfcbfvvflxkdw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpZ2lzZ2ViZmNiZnZ2Zmx4a2R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NDgyMTUsImV4cCI6MjA5NjEyNDIxNX0.9xzFogGmj8v6ayDObpcDRgPzQWybuBMXmcpsfoOFRXw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
