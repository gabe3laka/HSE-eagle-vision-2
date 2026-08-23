import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Crosshair, Loader2, Mic, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useMediaAttach } from "@/features/report-composer/hooks/useMediaAttach";
import { useReportDraft } from "@/features/report-composer/hooks/useReportDraft";
import type { LensContext } from "@/features/report-composer/lib/reasoningClient";

const PLACEHOLDERS = [
  "Ask about what the lens is seeing…",
  "Describe a near-miss…",
  "Why is this flagged?",
];

/**
 * Slim composer under the Live camera shell — the same brain as the Home
 * composer (classify-first via useReportDraft → reasoningClient), with one
 * extra: when the X-Ray lens is pinned on something, its frozen context rides
 * along as `lensContext`. Questions get an inline answer card (Live has no
 * thread UI); drafting navigates to /report/:id for HUMAN review — nothing
 * here files an incident. Voice stays "coming soon", exactly like Home.
 */
export function LiveComposerDock({
  lensContext,
  onClearLensContext,
}: {
  lensContext: LensContext | null;
  onClearLensContext: () => void;
}) {
  const navigate = useNavigate();
  const { isAnonymous, credits, refreshProfile } = useAuth();
  const { media, processing, addFiles, removeAt, clear, atLimit } = useMediaAttach();
  const { submit, submitting } = useReportDraft();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 4200);
    return () => clearInterval(t);
  }, []);

  const busy = submitting || processing;
  const canSend = text.trim().length > 0 || media.length > 0;

  const send = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (busy || (!trimmed && media.length === 0)) return;

    // Same friendly UI gate as Home; the server remains authoritative.
    if (isAnonymous && credits <= 0) {
      toast({
        title: "You've used your free drafts",
        description: "Create an account to keep going.",
      });
      navigate({ to: "/auth" });
      return;
    }

    const result = await submit({ text: trimmed, media, lensContext });

    if (result.type === "failed") {
      toast({
        title: "Couldn't process that",
        description: "Please try again.",
        variant: "destructive",
      });
      return;
    }
    if (result.type === "limit") {
      toast({
        title: "You've used your free drafts",
        description: "Create an account to keep going.",
      });
      navigate({ to: "/auth" });
      return;
    }

    void refreshProfile();

    if (result.type === "answer") {
      // A question — answer inline; the camera stays up, nothing was persisted.
      setAnswer(result.answer);
      setText("");
      clear();
      return;
    }

    // Drafted a report → human review screen (leaving Live is the point here).
    setText("");
    clear();
    navigate({ to: "/report/$id", params: { id: result.id } });
  };

  return (
    <div
      data-testid="live-composer-dock"
      className="mx-auto mb-3 w-full max-w-[680px] px-1 sm:mb-4"
    >
      {/* Inline answer card — Live has no conversation thread to land it in. */}
      {answer && (
        <div className="animate-fade-in mb-2 flex items-start gap-2 rounded-xl border border-border bg-card/80 p-3 text-sm shadow-sm backdrop-blur">
          <p className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed">{answer}</p>
          <button
            type="button"
            aria-label="Dismiss answer"
            onClick={() => setAnswer(null)}
            className="pressable shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="focus-glow rounded-2xl border border-border bg-card/80 p-2.5 shadow-[var(--shadow-float)] backdrop-blur supports-[backdrop-filter]:bg-card/60">
        {/* Pinned-lens context chip — display only; the numbers come from the
            backend risk data the lens showed, never computed here. */}
        {lensContext && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              data-testid="lens-context-chip"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs text-foreground"
            >
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate">
                {lensContext.label}
                {lensContext.risk_level ? ` · ${lensContext.risk_level}` : ""}
                {lensContext.severity != null && lensContext.likelihood != null
                  ? ` · S${lensContext.severity}×L${lensContext.likelihood}`
                  : ""}
              </span>
              <button
                type="button"
                aria-label="Remove lens context"
                onClick={onClearLensContext}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="draft-from-lens"
              className="pressable h-7 rounded-full px-3 text-xs"
              disabled={busy}
              onClick={() => void send(text.trim() || "Draft an incident report for this")}
            >
              Draft incident from lens
            </Button>
          </div>
        )}

        {media.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {media.map((m, i) => (
              <div key={i} className="relative">
                <img
                  src={m.thumb}
                  alt={m.name}
                  className="h-12 w-12 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => removeAt(i)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="pressable h-9 w-9 shrink-0 rounded-full text-muted-foreground"
            aria-label="Attach photo"
            disabled={atLimit || busy}
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 rounded-full text-muted-foreground opacity-50"
            aria-label="Voice memo (coming soon)"
            title="Voice memo — coming soon"
            disabled
          >
            <Mic className="h-5 w-5" />
          </Button>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            rows={1}
            className={`${focused || text.includes("\n") ? "min-h-[68px]" : "min-h-[40px]"} flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none transition-[min-height] duration-200 focus-visible:ring-0`}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send(text);
            }}
          />

          <Button
            type="button"
            size="icon"
            className="btn-sheen pressable h-11 w-11 shrink-0 rounded-full"
            aria-label="Send"
            disabled={busy || !canSend}
            onClick={() => void send(text)}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {submitting && (
          <div className="animate-fade-in mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Agent is working…
          </div>
        )}
      </div>
    </div>
  );
}
