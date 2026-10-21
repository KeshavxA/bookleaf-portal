import type { ChatMessage, SystemBlock } from "../llm/types";
import { kbSectionFor } from "../kb";
import { formatHumanDate } from "../../lib/dates";
import { escapeTags, userText } from "../promptText";
import { DRAFTER_SYSTEM_PROMPT } from "./systemPrompt";
import { buildFacts } from "./facts";
import { isPaymentRelated } from "./relevance";
import { applicablePoints } from "./requiredPoints";
import type { DraftContext } from "./types";

export const THREAD_WINDOW = 6;
const DESCRIPTION_MAX_CHARS = 3000;
const MESSAGE_MAX_CHARS = 1500;

/**
 * Prompt layout (stable -> volatile, so the prefix caches):
 *   system[0] static instructions           cache breakpoint (shared by every draft)
 *   system[1] KB section for this category  cache breakpoint (shared per category)
 * (Breakpoints are explicit on Anthropic; Gemini can only benefit from implicit prefix caching.)
 *   user      FACTS + original query + last N thread messages
 *
 * Everything the author (or staff) typed goes through userText(): escaped so it
 * cannot close <original_query>/<thread> or forge a <facts> block, and capped in length.
 */
/**
 * Per-ticket instructions computed in code (not cached: they vary with category and content):
 * whether money belongs in the reply, and the KB points to cover (see requiredPoints.ts).
 */
export function focusNotes(ctx: DraftContext): string[] {
  const notes: string[] = [];
  if (isPaymentRelated(ctx)) {
    notes.push("- This ticket is about payment. Use the royalty facts; ask about bank details at most once, and only if FACTS say they are unknown or not linked.");
  } else {
    notes.push("- This ticket is not about payment. Do not mention royalties, payouts, payment dates, the payout threshold or bank details.");
  }
  const points = applicablePoints(ctx);
  if (points.length > 0) {
    notes.push("- Cover these points (skip one only if it clearly does not apply):");
    points.forEach((p, i) => notes.push(`  ${i + 1}. ${p.instruction}`));
  }
  return notes;
}

export function buildDraftPrompt(ctx: DraftContext): {
  system: SystemBlock[];
  messages: ChatMessage[];
  factsText: string;
} {
  const facts = buildFacts(ctx);
  const recent = ctx.thread.slice(-THREAD_WINDOW);
  const omitted = ctx.thread.length - recent.length;

  const threadText = recent.length
    ? recent
        .map((m) => {
          const who = m.senderType === "AUTHOR" ? `Author (${m.senderName})` : `BookLeaf staff (${m.senderName})`;
          return `[${escapeTags(who)}, ${formatHumanDate(m.createdAt)}]\n${userText(m.body, MESSAGE_MAX_CHARS)}`;
        })
        .join("\n\n")
    : "(no replies yet)";

  const lastAuthorIsLatest = recent.length === 0 || recent[recent.length - 1]!.senderType === "AUTHOR";
  const task = lastAuthorIsLatest
    ? "Draft BookLeaf's reply to the author's most recent message (the original query if there are no replies yet)."
    : "BookLeaf replied last. Draft a short follow-up that moves the ticket forward without repeating the previous reply.";

  const user = `<facts>
${facts}
</facts>

<focus>
${focusNotes(ctx).join("\n")}
</focus>

<original_query>
<subject>${escapeTags(ctx.ticket.subject)}</subject>
<description>
${userText(ctx.ticket.description, DESCRIPTION_MAX_CHARS)}
</description>
</original_query>

<thread${omitted > 0 ? ` note="${omitted} older message(s) omitted"` : ""}>
${threadText}
</thread>

${task}`;

  return {
    system: [
      { text: DRAFTER_SYSTEM_PROMPT, cache: true },
      { text: `<policy>\n${kbSectionFor(ctx.ticket.category)}\n</policy>`, cache: true },
    ],
    messages: [{ role: "user", content: user }],
    factsText: facts,
  };
}
