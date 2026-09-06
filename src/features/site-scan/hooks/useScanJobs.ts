/**
 * useScanJobs — after finish, poll `GET /capture/jobs/{job_id}` and, on a
 * terminal result, persist a `scan_sessions` row through the typed-loose `db`
 * shim (same convention as `blueprints`; RLS keeps rows owner-only).
 *
 * The app owns persistence; the worker never talks to Supabase.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import { SCAN_JOB_POLL_MS, type ScanMode } from "../config";
import { getScanJob } from "../api/scanClient";
import type { ScanJob, ScanJobResult, ScanSessionInfo, ScanSessionRow } from "../types";

export interface ScanJobTracker {
  job: ScanJob | null;
  polling: boolean;
  saved: boolean;
  saveError: string | null;
  /** Begin polling a job; persists the row when the job reaches done/error. */
  track: (session: ScanSessionInfo, jobId: string, frameCount: number) => void;
  reset: () => void;
}

/** Pure: shape the row inserted into `scan_sessions` from a job result. */
export function scanResultToRow(
  ownerId: string,
  mode: ScanMode,
  jobId: string,
  frameCount: number,
  result: ScanJobResult | null,
  error: string | null,
): Omit<ScanSessionRow, "id" | "created_at"> {
  const ok = !!result && result.status === "done" && !error;
  return {
    owner_id: ownerId,
    type: mode,
    status: ok ? "done" : "error",
    frame_count: result?.frame_count ?? frameCount,
    mat_detected: !!result?.metric,
    artifact_url: result?.artifact_url ?? null,
    map_code: result?.map_code ?? null,
    object_anchor_id: result?.object_anchor_id ?? null,
    error: error ?? result?.error ?? null,
    worker_job_id: jobId,
  };
}

export function useScanJobs(): ScanJobTracker {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [job, setJob] = useState<ScanJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeRef = useRef<{ session: ScanSessionInfo; jobId: string; frameCount: number } | null>(
    null,
  );

  const persist = useMutation({
    mutationFn: async (row: Omit<ScanSessionRow, "id" | "created_at">) => {
      const { error } = await db.from("scan_sessions").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["scan_sessions"] });
    },
    onError: (e) => setSaveError((e as Error).message ?? "save_failed"),
  });

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      const active = activeRef.current;
      if (!active || cancelled) return;
      try {
        const j = await getScanJob(active.session, active.jobId);
        if (cancelled) return;
        setJob(j);
        if (j.status === "done" || j.status === "error") {
          setPolling(false);
          if (user) {
            persist.mutate(
              scanResultToRow(
                user.id,
                active.session.mode,
                active.jobId,
                active.frameCount,
                j.result,
                j.error,
              ),
            );
          } else {
            setSaveError("not_signed_in");
          }
        }
      } catch (e) {
        if (cancelled) return;
        setJob({
          job_id: active.jobId,
          status: "error",
          result: null,
          error: (e as Error).message ?? "poll_failed",
        });
        setPolling(false);
      }
    };
    void tick();
    const id = setInterval(tick, SCAN_JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // persist is stable per render of useMutation; user id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, user?.id]);

  const track = useCallback((session: ScanSessionInfo, jobId: string, frameCount: number) => {
    activeRef.current = { session, jobId, frameCount };
    setJob({ job_id: jobId, status: "queued", result: null, error: null });
    setSaved(false);
    setSaveError(null);
    setPolling(true);
  }, []);

  const reset = useCallback(() => {
    activeRef.current = null;
    setJob(null);
    setPolling(false);
    setSaved(false);
    setSaveError(null);
  }, []);

  return { job, polling, saved, saveError, track, reset };
}

/** Recent scans for the signed-in owner (RLS-scoped). */
export function useRecentScans(limit = 8) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["scan_sessions", user?.id, limit],
    enabled: !!user,
    queryFn: async (): Promise<ScanSessionRow[]> => {
      const { data, error } = await db
        .from("scan_sessions")
        .select(
          "id, owner_id, type, status, frame_count, mat_detected, artifact_url, map_code, object_anchor_id, error, worker_job_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ScanSessionRow[];
    },
  });
}

// ── Manual-ingestion loop (MULTISET_INGEST_MODE=manual) ──────────────────────
// The worker returns an artifact URL and leaves map_code / object_anchor_id
// null; the operator uploads to MultiSet and enters the returned id here.

/** PURE: id-shape validation. Site scans take MultiSet map codes; object scans
 *  take an anchor id (any non-empty trimmed string MultiSet hands back). */
export function isValidMapCode(value: string): boolean {
  return /^MAP_[A-Za-z0-9]+$/.test(value.trim());
}
export function isValidAnchorId(value: string): boolean {
  return value.trim().length > 0;
}
export function isValidIngestionId(mode: ScanMode, value: string): boolean {
  return mode === "site" ? isValidMapCode(value) : isValidAnchorId(value);
}

/** PURE: may the operator enter an ingestion id on this row?
 *  Only a finished scan that still lacks its id — and an object scan without
 *  the mat is NOT metric, so it can never become an object anchor. */
export function canEnterIngestionId(
  row: Pick<ScanSessionRow, "type" | "status" | "mat_detected" | "map_code" | "object_anchor_id">,
): boolean {
  if (row.status !== "done") return false;
  if (row.type === "object") return row.mat_detected && row.object_anchor_id === null;
  return row.map_code === null;
}

/** PURE: the column patch a valid id produces (status transitions to
 *  'ingested' — the CHECK constraint in the scan_sessions migration allows it). */
export function ingestionPatch(
  mode: ScanMode,
  id: string,
): { status: "ingested"; map_code?: string; object_anchor_id?: string } {
  const trimmed = id.trim();
  return mode === "site"
    ? { status: "ingested", map_code: trimmed }
    : { status: "ingested", object_anchor_id: trimmed };
}

/** Write the operator-entered MultiSet id back onto a scan_sessions row.
 *  Validates shape and THROWS on any failure — a failed write must surface in
 *  the UI, never silently no-op. RLS scopes the update to the owner. */
export async function setIngestionId(
  rowId: string,
  mode: ScanMode,
  id: string,
): Promise<{ status: "ingested"; map_code?: string; object_anchor_id?: string }> {
  if (!isValidIngestionId(mode, id)) {
    throw new Error(mode === "site" ? "invalid_map_code" : "invalid_anchor_id");
  }
  const patch = ingestionPatch(mode, id);
  const { error } = await db.from("scan_sessions").update(patch).eq("id", rowId);
  if (error) throw new Error(error.message ?? "update_failed");
  return patch;
}

/** List the signed-in owner's scan sessions, newest first (RLS-scoped). */
export async function listSessions(limit = 20): Promise<ScanSessionRow[]> {
  const { data, error } = await db
    .from("scan_sessions")
    .select(
      "id, owner_id, type, status, frame_count, mat_detected, artifact_url, map_code, object_anchor_id, error, worker_job_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message ?? "list_failed");
  return (data ?? []) as ScanSessionRow[];
}

/** Mutation wrapper for the sessions list: writes the id, refreshes the list. */
export function useSetIngestionId() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rowId: string; mode: ScanMode; id: string }) =>
      setIngestionId(input.rowId, input.mode, input.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan_sessions"] }),
  });
}
