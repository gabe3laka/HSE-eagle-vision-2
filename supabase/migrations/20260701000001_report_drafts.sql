-- Home composer (Plan 1, Phase 1): agentic report drafts.
--
-- A draft is the agent's structured suggestion built from the user's text /
-- photo input on the Home composer. It is NEVER an incident by itself — the
-- human review screen (/report/:id) is the approval gate, and approving files a
-- separate row into the existing public.incidents table (owner-inserted, same
-- as live monitoring does today). Discarded drafts stay for audit.

CREATE TABLE report_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'drafting'
    CHECK (status IN ('drafting','draft','approved','discarded')),
  -- Raw user inputs.
  input_text text NOT NULL DEFAULT '',
  transcript text,                     -- voice memo transcript (Phase 3, unused yet)
  -- Small client-downscaled photo thumbnails [{thumb,w,h,name}]. Never raw
  -- video and never broadcast anywhere — review-screen context only.
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The agent's structured draft: { report_type, hazard_type, severity, title,
  -- summary, probable_cause, corrective_action, confidence, source }.
  draft jsonb,
  -- Set when the human approves and the incident row is created.
  incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_drafts ENABLE ROW LEVEL SECURITY;

-- Owner-only in every direction: drafts are personal working documents until
-- they are filed as incidents (which have their own policies).
CREATE POLICY "report drafts select own" ON report_drafts
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "report drafts insert own" ON report_drafts
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "report drafts update own" ON report_drafts
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "report drafts delete own" ON report_drafts
  FOR DELETE USING (auth.uid() = owner_id);

CREATE INDEX report_drafts_owner_created_idx
  ON report_drafts (owner_id, created_at DESC);
