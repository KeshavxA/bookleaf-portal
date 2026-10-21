/**
 * Helpers for putting user-written text (ticket subject/description, messages)
 * into prompts. The text is stored raw in the database; only its prompt copy is
 * transformed, so it can't close our XML-style delimiters and inject fake
 * <facts> or instructions.
 */

/** Replaces angle brackets with look-alike guillemets so author text can't open or close tags. */
export function escapeTags(s: string): string {
  return s.replace(/</g, "‹").replace(/>/g, "›");
}

/** Caps prompt size per field; the stored text is untouched. */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [truncated]` : s;
}

/** Escaped and length-capped: the form every piece of user text takes in a prompt. */
export function userText(s: string, max: number): string {
  return escapeTags(clip(s, max));
}
