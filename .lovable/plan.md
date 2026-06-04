## Goal

Fix the 6 TypeScript errors by populating `src/integrations/supabase/types.ts` with the real schema of the external backend (`pigisgebfcbfvvflxkdw`), since Lovable cannot auto-generate types for an external Supabase project.

## Source of truth

The uploaded `HSE-eagle-vision-main-3.zip` contains a fully-generated `src/integrations/supabase/types.ts` (421 lines) produced from the same schema that was applied to `pigisgebfcbfvvflxkdw`. Tables: `profiles`, `alert_settings`, `monitoring_sessions`, `hazard_zones`, `detections`, `incidents`. Enums: `hazard_type`, `severity`, `session_status`, `zone_kind`. This file is the exact shape `RiskHeatmap.tsx`, `useIncidents.ts`, and `lib/detection/types.ts` are written against.

## Steps

1. **Overwrite `src/integrations/supabase/types.ts`** with the verbatim contents of the uploaded project's `types.ts`. Despite the standard "never edit types.ts" rule (which protects Lovable-managed regeneration), Option B explicitly requires manual maintenance because Lovable's introspection points at the empty managed project, not the external one.

2. **Verify the 6 errors resolve** by re-checking:
   - `RiskHeatmap.tsx:4` — `Database["public"]["Enums"]["severity"]` ✓
   - `useIncidents.ts:6,7,43` — `Tables["incidents"|"monitoring_sessions"|"detections"]["Row"]` ✓
   - `lib/detection/types.ts:3,4` — `Enums["hazard_type"|"severity"]` ✓

3. **Do not touch anything else.** Leave `own-client.ts`, `db.ts`, `client.ts`, and all hooks unchanged. No migrations against the Lovable-managed project. No edits to `.env`. No changes to other components.

## Caveat to flag to the user

`types.ts` will NOT auto-regenerate while you stay on the external backend. Any future schema change in `pigisgebfcbfvvflxkdw` must be mirrored here by hand (or by pasting in a freshly generated file from the Supabase dashboard's TypeScript types page for that project). If Lovable's automation ever overwrites this file with the empty stub, the same 6 errors will return and the fix is to paste the contents back.

## Out of scope

- Switching to the Lovable-managed backend (Option A).
- Running migrations, adding RLS, or touching auth.
- Any UI / business-logic changes.
