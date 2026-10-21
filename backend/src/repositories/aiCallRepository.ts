import type { Db } from "../lib/prisma";
import type { AiCallRecord, AiCallRecorder } from "../ai/llm/types";

/** Implements the AI module's persistence port. */
export class AiCallRepository implements AiCallRecorder {
  constructor(private readonly db: Db) {}

  async record(call: AiCallRecord): Promise<void> {
    const { provider: _provider, ...data } = call; // no column for it yet
    await this.db.aiCall.create({ data });
  }
}
