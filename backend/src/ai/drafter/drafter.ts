import { LlmOutputError, type LlmPort } from "../llm/types";
import { kbSectionFor } from "../kb";
import { buildDraftPrompt } from "./prompt";
import { DRAFTER_SYSTEM_PROMPT, SIGN_OFF } from "./systemPrompt";
import { findUngroundedNumbers } from "./grounding";
import { bodyWordCount, countBankRequests, dedupeBankRequests, WARN_WORDS } from "./checks";
import type { DraftContext } from "./types";

/** ~180 words is ~270 tokens; headroom covers adaptive thinking at low effort. */
const DRAFT_MAX_TOKENS = 1500;

export interface DraftResult {
  body: string;
  ungroundedNumbers: string[];
  /** Logged by the caller; a draft is never rejected for these. */
  warnings: string[];
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
        // Length is never a reason to fail (see warnings below); an empty reply is.
        if (bodyWordCount(body) === 0) throw new LlmOutputError("draft is empty");
        return { body, bankRequestsInRaw: countBankRequests(res.text) };
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
    const { body } = value;
    const warnings: string[] = [];
    const words = bodyWordCount(body);
    if (words < WARN_WORDS.min || words > WARN_WORDS.max) {
      warnings.push(`draft body is ${words} words (expected ${WARN_WORDS.min}-${WARN_WORDS.max})`);
    }
    if (value.bankRequestsInRaw > 1) {
      warnings.push(`model asked for bank details ${value.bankRequestsInRaw} times; kept the first`);
    }
    return { body, ungroundedNumbers: findUngroundedNumbers(body, sources), warnings };
  }
}

/** Enforce plain text, a single bank-details request and the house sign-off regardless of what the model did. */
export function postProcess(raw: string): string {
  let text = raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = dedupeBankRequests(text);
  if (!text) return text;
  if (!/BookLeaf Support Team\s*$/.test(text)) {
    text = `${text.replace(/\n*(Warm regards|Best regards|Regards|Thanks),?\s*$/i, "")}\n\n${SIGN_OFF}`;
  }
  return text;
}
