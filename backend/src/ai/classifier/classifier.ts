import { applyPriorityFloor } from "./rules";
import { classifyByKeywords } from "./keywordFallback";
import { CLASSIFICATION_JSON_SCHEMA, ClassificationSchema, type Classification } from "./schema";
import { CLASSIFIER_SYSTEM_PROMPT, buildClassifierMessages, type ClassifierInput } from "./prompt";
import { LlmError, LlmOutputError, type LlmPort } from "../llm/types";
import type { Category, Priority } from "../../domain/enums";

/** Small: the answer is ~40 tokens of JSON and thinking is disabled for this call. */
const CLASSIFIER_MAX_TOKENS = 256;

export type ClassificationOutcome =
  | {
      source: "AI";
      category: Category;
      priority: Priority;
      /** What the model actually said (before code floors), for the admin's "AI suggestion". */
      suggestion: Classification;
    }
  | {
      source: "FALLBACK";
      category: Category;
      priority: Priority;
      errorCode: string;
      errorMessage: string;
    };

export class TicketClassifier {
  constructor(private readonly llm: LlmPort) {}

  /** Never throws: any AI failure degrades to the keyword classifier. */
  async classify(input: ClassifierInput, ticketId: string | null = null): Promise<ClassificationOutcome> {
    try {
      const { value } = await this.llm.complete(
        {
          kind: "CLASSIFY",
          ticketId,
          // Identical on every call and above the 512-token cache minimum: cached reads are 10% of input price.
          system: [{ type: "text", text: CLASSIFIER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: buildClassifierMessages(input),
          maxTokens: CLASSIFIER_MAX_TOKENS,
          effort: "low",
          thinking: "disabled",
          jsonSchema: CLASSIFICATION_JSON_SCHEMA,
        },
        (res) => {
          if (res.stopReason === "max_tokens") throw new LlmOutputError("response truncated at max_tokens");
          let json: unknown;
          try {
            json = JSON.parse(res.text);
          } catch {
            throw new LlmOutputError("response was not valid JSON");
          }
          const parsed = ClassificationSchema.safeParse(json);
          if (!parsed.success) throw new LlmOutputError(`schema mismatch: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          return parsed.data;
        },
      );

      return {
        source: "AI",
        category: value.category,
        priority: applyPriorityFloor(value.category, value.priority),
        suggestion: value,
      };
    } catch (err) {
      const fallback = classifyByKeywords(input);
      return {
        source: "FALLBACK",
        category: fallback.category,
        priority: fallback.priority,
        errorCode: err instanceof LlmError ? err.code : "UNKNOWN",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
