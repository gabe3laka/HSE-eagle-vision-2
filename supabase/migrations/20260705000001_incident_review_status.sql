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

ALTER TABLE incidents
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'dismissed'));

-- Existing rows predate the gate; treat them as already-reviewed so history
-- keeps its meaning (dev/test rows are being cleared separately anyway).
UPDATE incidents SET review_status = 'approved';

CREATE INDEX incidents_review_status_idx ON incidents (owner_id, review_status);
