import { Link } from "@/lib/router-shim";
import { FileText, ShieldCheck } from "lucide-react";
import { useConversationMessages } from "./hooks/useConversations";

/**
 * The active conversation, rendered as a quiet chat thread under the composer.
 * User turns sit right (primary-tinted), assistant turns left (card). An
 * assistant turn that produced a report draft links straight to its review
 * screen. Hidden entirely until the thread has messages — Home stays minimal.
 */
export function ConversationThread({ conversationId }: { conversationId: string | null }) {
  const { data: messages = [] } = useConversationMessages(conversationId);

  if (!conversationId || messages.length === 0) return null;

  return (
    <div
      className="animate-fade-in mt-5 max-h-[46vh] space-y-3 overflow-y-auto pr-1"
      aria-label="Conversation"
    >
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2.5">
            <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/60 text-primary">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="console-panel max-w-[85%] rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.report_draft_id && (
                <Link
                  to={`/report/${m.report_draft_id}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden /> View report draft →
                </Link>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
