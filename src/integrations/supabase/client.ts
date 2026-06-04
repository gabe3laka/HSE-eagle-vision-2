// OPTION B OVERRIDE — this project uses the external Supabase project
// `pigisgebfcbfvvflxkdw`, not the Lovable-managed one. The standard
// `@/integrations/supabase/client` import is re-exported from `own-client`
// so any code following the default Lovable pattern still lands on the
// correct project.
//
// NOTE: Lovable's automation may regenerate this file and revert it to
// point at the managed project. If that happens, re-apply this re-export.
export { supabase } from "./own-client";
