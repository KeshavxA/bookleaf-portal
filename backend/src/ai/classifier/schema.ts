import { z } from "zod";
import { CATEGORIES, PRIORITIES } from "../../domain/enums";

export const REASONING_MAX_WORDS = 20;

/** JSON schema sent as the structured-output format: the model can only emit valid enums. */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    priority: { type: "string", enum: [...PRIORITIES] },
    reasoning: {
      type: "string",
      description: `Why this category and priority, at most ${REASONING_MAX_WORDS} words.`,
    },
  },
  required: ["category", "priority", "reasoning"],
  additionalProperties: false,
} as const;

/** Second line of defence: we still validate whatever comes back. */
export const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  reasoning: z
    .string()
    .trim()
    .min(1)
    // Cosmetic limit: trim rather than reject a correct classification for being wordy.
    .transform((s) => s.split(/\s+/).slice(0, REASONING_MAX_WORDS).join(" ")),
});

export type Classification = z.infer<typeof ClassificationSchema>;
