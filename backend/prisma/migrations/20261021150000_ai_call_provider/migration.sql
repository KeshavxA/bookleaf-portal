-- Which LLM provider served the call. Nullable, no backfill: existing rows are left as they are.
ALTER TABLE "AiCall" ADD COLUMN "provider" TEXT;
