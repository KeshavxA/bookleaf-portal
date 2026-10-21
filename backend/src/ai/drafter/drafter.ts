import { LlmOutputError, type LlmPort } from "../llm/types";
import { kbSectionFor } from "../kb";
import { buildDraftPrompt } from "./prompt";
import { DRAFTER_SYSTEM_PROMPT, SIGN_OFF } from "./systemPrompt";
import { findUngroundedNumbers } from "./grounding";
import type { DraftContext } from "./types";

/** ~200 words is ~300 tokens; headroom covers adaptive thinking at low effort. */
const DRAFT_MAX_TOKENS = 1500;
const MIN_WORDS = 40;

export interface DraftResult {
  body: string;
  ungroundedNumbers: string[];
}

export class TicketDrafter {
  constructor(private readonly llm: LlmPort) {}

  /** Throws LlmError on failure; the caller decides how to degrade. */
  async draft(ctx: DraftContext): Promise<DraftResult> {
    const { system, messages, factsText } = buildDraftPrompt(ctx);

    const { value } = await this.llm.complete(
      { kind: "DRAFT", ticketId: ctx.ticket.id, system, messages, maxTokens: DRAFT_MAX_TOKENS, effort: "low" },
      (res) => {
        if (res.stopReason === "max_tokens") throw new LlmOutputError("draft truncated at max_tokens");
        const body = postProcess(res.text);
        if (body.split(/\s+/).length < MIN_WORDS) throw new LlmOutputError("draft too short");
        return body;
      },
    );

    const sources = [
      factsText,
      kbSectionFor(ctx.ticket.category),
      DRAFTER_SYSTEM_PROMPT,
      ctx.ticket.description,
      ctx.ticket.subject,
      ...ctx.thread.map((m) => m.body),
    ];
    return { body: value, ungroundedNumbers: findUngroundedNumbers(value, sources) };
  }
}

/** Enforce plain text and the house sign-off regardless of what the model did. */
export function postProcess(raw: string): string {
  let text = raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return text;
  if (!/BookLeaf Support Team\s*$/.test(text)) {
    text = `${text.replace(/\n*(Warm regards|Best regards|Regards|Thanks),?\s*$/i, "")}\n\n${SIGN_OFF}`;
  }
  return text;
}
