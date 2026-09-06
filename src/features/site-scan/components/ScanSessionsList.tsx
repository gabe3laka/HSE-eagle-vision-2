/**
 * ScanSessionsList — the manual-ingestion loop for scan results.
 *
 * In MULTISET_INGEST_MODE=manual the worker returns an artifact URL and leaves
 * map_code / object_anchor_id null. The operator uploads the artifact to
 * MultiSet, gets an id back, and enters it HERE — the row flips to
 * status 'ingested' and the VPS tier can start matching on the map code.
 * A scan whose mat was never detected is NOT metric: badged clearly, and for
 * object scans that makes it unusable as an object anchor (entry blocked).
 */

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canEnterIngestionId,
  isValidIngestionId,
  useRecentScans,
  useSetIngestionId,
} from "../hooks/useScanJobs";
import type { ScanSessionRow } from "../types";

export function ScanSessionsList() {
  const scans = useRecentScans(20);

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium">Scan sessions</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Upload each artifact at console.multiset.ai, then enter the returned id below.
      </p>
      {scans.isLoading && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {scans.isError && (
        <p className="mt-3 text-xs text-destructive">
          Couldn&apos;t load scan sessions: {(scans.error as Error)?.message ?? "unknown error"}
        </p>
      )}
      {scans.data && scans.data.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No scans yet — run a Site or Object scan above and it will land here.
        </p>
      )}
      {scans.data && scans.data.length > 0 && (
        <ul className="mt-3 space-y-3">
          {scans.data.map((row) => (
            <SessionRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionRow({ row }: { row: ScanSessionRow }) {
  const ingestedId = row.type === "site" ? row.map_code : row.object_anchor_id;
  return (
    <li className="rounded-lg border border-border/70 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium capitalize">{row.type}</span>
        <StatusChip status={row.status} />
        <MetricBadge row={row} />
        <span className="text-muted-foreground">{row.frame_count} frames</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      </div>

      {row.status === "error" && row.error && (
        <p className="mt-1.5 text-destructive">{row.error}</p>
      )}

      {row.artifact_url && <ArtifactLine url={row.artifact_url} />}

      {ingestedId ? (
        <p className="mt-1.5">
          <span className="text-muted-foreground">
            {row.type === "site" ? "map_code" : "object anchor"}:
          </span>{" "}
          <code>{ingestedId}</code>
        </p>
      ) : canEnterIngestionId(row) ? (
        <IngestionField row={row} />
      ) : row.status === "done" && row.type === "object" && !row.mat_detected ? (
        <p className="mt-1.5 text-amber-500">
          Anchor entry blocked — rescan with the Scan Mat in view to get a metric result.
        </p>
      ) : null}
    </li>
  );
}

function StatusChip({ status }: { status: ScanSessionRow["status"] }) {
  const tone =
    status === "ingested"
      ? "border-primary/50 text-primary"
      : status === "done"
        ? "border-emerald-500/50 text-emerald-500"
        : "border-destructive/50 text-destructive";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone}`}>{status}</span>;
}

function MetricBadge({ row }: { row: ScanSessionRow }) {
  if (row.status === "error") return null;
  if (row.mat_detected) {
    return (
      <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-500">
        metric
      </span>
    );
  }
  return (
    <span
      className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-500"
      title="The Scan Mat was never detected — no metric scale"
    >
      NOT metric{row.type === "object" ? " · unusable for anchor" : ""}
    </span>
  );
}

function ArtifactLine({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="mt-1.5 flex items-center gap-1.5">
      <span className="truncate text-muted-foreground" title={url}>
        {url}
      </span>
      <button
        type="button"
        aria-label="Copy artifact URL"
        className="pressable shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => setCopied(false),
          );
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </p>
  );
}

function IngestionField({ row }: { row: ScanSessionRow }) {
  const [value, setValue] = useState("");
  const save = useSetIngestionId();
  const valid = isValidIngestionId(row.type, value);
  const placeholder = row.type === "site" ? "MAP_…" : "MultiSet object anchor id";

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={row.type === "site" ? "MultiSet map code" : "MultiSet object anchor id"}
          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !save.isPending) {
              save.mutate({ rowId: row.id, mode: row.type, id: value });
            }
          }}
        />
        <Button
          size="sm"
          className="h-8"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({ rowId: row.id, mode: row.type, id: value })}
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
      {value && !valid && (
        <p className="mt-1 text-[11px] text-amber-500">
          {row.type === "site"
            ? "Map codes look like MAP_ followed by letters/digits."
            : "Anchor id can't be empty."}
        </p>
      )}
      {save.isError && (
        <p className="mt-1 text-[11px] text-destructive">
          Save failed: {(save.error as Error)?.message ?? "unknown error"}
        </p>
      )}
    </div>
  );
}
