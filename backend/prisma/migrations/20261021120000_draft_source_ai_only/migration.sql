-- Contract v1.1: draft.source is only "AI". FALLBACK was never written by the
-- backend; the UPDATE only guards against hand-edited rows so the cast can't fail.
BEGIN;
UPDATE "Ticket" SET "draftBody" = NULL, "draftSource" = NULL, "draftGeneratedAt" = NULL WHERE "draftSource" = 'FALLBACK';
CREATE TYPE "DraftSource_new" AS ENUM ('AI');
ALTER TABLE "Ticket" ALTER COLUMN "draftSource" TYPE "DraftSource_new" USING ("draftSource"::text::"DraftSource_new");
ALTER TYPE "DraftSource" RENAME TO "DraftSource_old";
ALTER TYPE "DraftSource_new" RENAME TO "DraftSource";
DROP TYPE "DraftSource_old";
COMMIT;
