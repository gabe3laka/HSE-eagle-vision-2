import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import type { ConversationRow, MessageRow, MessageRole } from "@/integrations/supabase/db";
import type { AttachedMedia } from "./useMediaAttach";

/**
 * Conversation history for the Home composer (ChatGPT-like). Additive over the
 * existing report_drafts flow: a conversation groups the composer turns; the
 * heavy structured draft still lives in report_drafts and is linked from the
 * assistant message (report_draft_id). All access is owner-scoped by RLS, so
 * a guest (anonymous session) sees only their own threads.
 */

/** Owned, non-archived threads, most-recent first, with optional title search. */
export function useConversations(search = "") {
  const query = useQuery({
    queryKey: ["conversations"],
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await db
        .from("conversations")
        .select("*")
        .eq("archived", false)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data as ConversationRow[]) ?? [];
    },
  });

  const term = search.trim().toLowerCase();
  const conversations = term
    ? (query.data ?? []).filter((c) => (c.title ?? "").toLowerCase().includes(term))
    : (query.data ?? []);

  return { conversations, isLoading: query.isLoading, refetch: query.refetch };
}

/** Ordered messages for one thread. */
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await db
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as MessageRow[]) ?? [];
    },
  });
}

/** Create a thread. owner_id is filled by the DB default (auth.uid()). */
export async function createConversation(title: string | null): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .insert({ title: title?.slice(0, 80) ?? null })
    .select("id")
    .single();
  if (error || !data?.id) return null;
  return data.id as string;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await db
    .from("conversations")
    .update({ title: title.slice(0, 80), updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function archiveConversation(id: string): Promise<void> {
  await db.from("conversations").update({ archived: true }).eq("id", id);
}

export async function addMessage(input: {
  conversationId: string;
  role: MessageRole;
  content?: string | null;
  media?: AttachedMedia[];
  reportDraftId?: string | null;
}): Promise<void> {
  await db.from("messages").insert({
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content ?? null,
    media: input.media ?? [],
    report_draft_id: input.reportDraftId ?? null,
  });
}

/** Bump recency (and set the title on first turn) so the list sorts correctly. */
export async function touchConversation(id: string, title?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (title) patch.title = title.slice(0, 80);
  await db.from("conversations").update(patch).eq("id", id);
}

/** Most recent report draft in a thread — the "continue drafting" entry point. */
export async function latestDraftIdForConversation(conversationId: string): Promise<string | null> {
  const { data } = await db
    .from("messages")
    .select("report_draft_id, created_at")
    .eq("conversation_id", conversationId)
    .not("report_draft_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { report_draft_id: string | null } | null)?.report_draft_id ?? null;
}
