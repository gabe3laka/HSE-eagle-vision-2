import { Badge } from "@/components/ui/badge";

export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || confidence === undefined) return <Badge variant="outline">N/A</Badge>;
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">{pct}%</Badge>;
  if (pct >= 50) return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30">{pct}%</Badge>;
  return <Badge className="bg-red-500/15 text-red-600 border-red-500/30">{pct}%</Badge>;
}
