import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router-shim";
import { FileClock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/supabase/db";
import type { ReportDraftRow } from "./types";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Small "pick up where you left off" strip under the Home composer: the
 *  viewer's unfiled drafts (owner-RLS'd). Hidden entirely when there are none,
 *  keeping the home minimal. */
export function RecentDrafts() {
  const { user } = useAuth();
  const { data: drafts = [] } = useQuery({
    queryKey: ["report_drafts", "recent", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<ReportDraftRow[]> => {
      const { data, error } = await db
        .from("report_drafts")
        .select("id, status, input_text, draft, created_at")
        .in("status", ["drafting", "draft"])
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return (data ?? []) as ReportDraftRow[];
    },
  });

  if (drafts.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <FileClock className="h-3 w-3" /> Drafts waiting for review
      </p>
      <div className="space-y-1.5">
        {drafts.map((d) => {
          const title =
            d.draft?.title || d.input_text.split(/[.\n]/)[0]?.slice(0, 70) || "Untitled report";
          return (
            <Link
              key={d.id}
              to={`/report/${d.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm transition-colors hover:bg-secondary/60"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {timeAgo(d.created_at)}
                  {d.draft?.severity ? ` · ${d.draft.severity}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className="text-[10px] capitalize">
                  {d.status === "drafting" ? "drafting…" : "review"}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
