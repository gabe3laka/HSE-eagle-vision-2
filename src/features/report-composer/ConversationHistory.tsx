import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Plus, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConversations, latestDraftIdForConversation } from "./hooks/useConversations";

/**
 * Quiet conversation history for the Home surface (ChatGPT-like). Lists the
 * owner's threads (guest or signed-in — RLS scopes them), with title search and
 * a "New" action. Selecting a thread continues it by reopening its most recent
 * report draft (/report/:id) — reusing the existing review screen, not a new page.
 */
export function ConversationHistory({
  activeConversationId,
  onSelect,
  onNew,
}: {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { conversations, isLoading } = useConversations(search);
  const [opening, setOpening] = useState<string | null>(null);

  if (!isLoading && conversations.length === 0 && !search) return null;

  const open = async (id: string) => {
    onSelect(id);
    setOpening(id);
    const draftId = await latestDraftIdForConversation(id);
    setOpening(null);
    if (draftId) navigate({ to: "/report/$id", params: { id: draftId } });
  };

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Your conversations
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 rounded-full px-2 text-xs text-muted-foreground"
          onClick={onNew}
        >
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations"
          className="h-8 pl-8 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : conversations.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          No conversations match “{search}”.
        </p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void open(c.id)}
                className={`hover-lift pressable flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm ${
                  activeConversationId === c.id
                    ? "border-primary/40 bg-primary/10"
                    : "border-border bg-card/60 hover:bg-secondary/60"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {c.title || "Untitled conversation"}
                </span>
                {opening === c.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span className="shrink-0 text-[10px] tabular text-muted-foreground">
                    {new Date(c.last_message_at).toLocaleDateString()}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
