import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Mic,
  ArrowUp,
  ChevronDown,
  ClipboardList,
  Camera,
  PenLine,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useMediaAttach } from "./hooks/useMediaAttach";
import { useReportDraft } from "./hooks/useReportDraft";

type ComposerMode = "report" | "hse" | "plan" | "build";

const MODES: { key: ComposerMode; label: string; hint: string; icon: typeof ClipboardList }[] = [
  {
    key: "report",
    label: "Report",
    hint: "Describe it — the agent drafts a safety report",
    icon: ClipboardList,
  },
  { key: "hse", label: "Monitor", hint: "Open the live safety camera", icon: Camera },
  { key: "plan", label: "Plan", hint: "Guide me through a task with the camera", icon: PenLine },
  { key: "build", label: "Build", hint: "Document my work with the camera", icon: PenLine },
];

const PLACEHOLDERS = [
  "Describe a near-miss or hazard…",
  "Report an incident from the floor…",
  "Ask about a safety procedure…",
  "Note a blocked exit or missing PPE…",
];

/**
 * The Lovable-style single input surface: multiline text, a photo attach, a
 * (disabled) voice button, a mode selector, and send. Report mode runs the
 * agent and lands on the review screen; the other modes deep-link into the Live
 * camera (behavior unchanged) via /live?mode=…. Feature-flagged upstream.
 */
export function HomeComposer() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { media, processing, addFiles, removeAt, atLimit } = useMediaAttach();
  const { submit, submitting } = useReportDraft();

  const [text, setText] = useState("");
  const [mode, setMode] = useState<ComposerMode>("report");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 4200);
    return () => clearInterval(t);
  }, []);

  const busy = submitting || processing;
  const canSend = mode !== "report" || text.trim().length > 0 || media.length > 0;
  const activeMode = MODES.find((m) => m.key === mode) ?? MODES[0];

  const handleSend = async () => {
    if (busy || !canSend) return;
    if (!user) {
      toast({
        title: "Sign in to continue",
        description: "Create a free account to save and submit your report.",
      });
      navigate({ to: "/auth" });
      return;
    }
    if (mode !== "report") {
      navigate({ to: "/live", search: { mode } });
      return;
    }

    const id = await submit({ text: text.trim(), media });
    if (!id) {
      toast({
        title: "Couldn't start the draft",
        description: "Please try again.",
        variant: "destructive",
      });
      return;
    }
    navigate({ to: "/report/$id", params: { id } });
  };

  return (
    <div className="rounded-2xl border border-border bg-card/80 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/60">
      {/* Attached photo thumbnails */}
      {media.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {media.map((m, i) => (
            <div key={i} className="relative">
              <img
                src={m.thumb}
                alt={m.name}
                className="h-16 w-16 rounded-lg border border-border object-cover"
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

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          mode === "report"
            ? PLACEHOLDERS[placeholderIdx]
            : `${activeMode.label}: ${activeMode.hint}`
        }
        rows={3}
        className="min-h-[76px] resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void handleSend();
        }}
      />

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

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full text-muted-foreground"
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
            className="h-9 w-9 rounded-full text-muted-foreground opacity-50"
            aria-label="Voice memo (coming soon)"
            title="Voice memo — coming soon"
            disabled
          >
            <Mic className="h-5 w-5" />
          </Button>

          {/* Mode selector — like Lovable's Build ▾ */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-1 h-9 gap-1 rounded-full px-3 text-xs"
              >
                <activeMode.icon className="h-3.5 w-3.5" />
                {activeMode.label}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {MODES.map((m) => (
                <DropdownMenuItem key={m.key} onClick={() => setMode(m.key)} className="gap-2">
                  <m.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-[11px] text-muted-foreground">{m.hint}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          type="button"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label={mode === "report" ? "Draft report" : `Open ${activeMode.label}`}
          disabled={busy || !canSend}
          onClick={() => void handleSend()}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
