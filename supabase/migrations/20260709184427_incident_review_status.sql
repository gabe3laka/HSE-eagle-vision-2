-- Pending-approval gate (workflow redesign, Step 4).
--
-- Nothing becomes a confirmed incident without a human. Live monitoring's
-- auto-persisted detections now land as review_status='pending' (the column
-- default — no writer changes needed) and surface in the Incidents tab's
-- "Pending approval" queue. A human either approves (→ 'approved', joins the
-- incident log and feeds Safety aggregation) or dismisses (→ 'dismissed',
-- kept as a false-positive record, never filed).
--
-- The composer path already has its human gate (/report/:id review), so its
-- insert writes review_status='approved' explicitly at approval time.

-- Idempotent: this migration was first applied out-of-band, so every statement
-- is guarded so a later `supabase db push` (or a fresh env) is a safe no-op.
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'dismissed'));

-- Back-fill ONLY rows created before this migration existed — never re-approve a
-- row that legitimately sits in the pending queue on a re-run. New rows keep the
-- 'pending' column default. Scoped by the migration's own timestamp.
UPDATE incidents
  SET review_status = 'approved'
  WHERE review_status = 'pending'
    AND created_at < '2026-07-09 18:44:27+00';

CREATE INDEX IF NOT EXISTS incidents_review_status_idx
  ON incidents (owner_id, review_status);
