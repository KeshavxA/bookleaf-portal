import type Anthropic from "@anthropic-ai/sdk";
import { kbSectionFor } from "../kb";
import { formatHumanDate } from "../../lib/dates";
import { escapeTags, userText } from "../promptText";
import { DRAFTER_SYSTEM_PROMPT } from "./systemPrompt";
import { buildFacts } from "./facts";
import type { DraftContext } from "./types";

export const THREAD_WINDOW = 6;
const DESCRIPTION_MAX_CHARS = 3000;
const MESSAGE_MAX_CHARS = 1500;

/**
 * Prompt layout (stable -> volatile, so the prefix caches):
 *   system[0] static instructions           cache breakpoint (shared by every draft)
 *   system[1] KB section for this category  cache breakpoint (shared per category)
 *   user      FACTS + original query + last N thread messages
 *
 * Everything the author (or staff) typed goes through userText(): escaped so it
 * cannot close <original_query>/<thread> or forge a <facts> block, and capped in length.
 */
export function buildDraftPrompt(ctx: DraftContext): {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
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
      { type: "text", text: DRAFTER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `<policy>\n${kbSectionFor(ctx.ticket.category)}\n</policy>`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
    factsText: facts,
  };
}
