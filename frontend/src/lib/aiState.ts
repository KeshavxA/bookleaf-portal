import type { AdminTicketSummary } from '@/api/types';

type AiFields = Pick<AdminTicketSummary, 'aiStatus' | 'categoryOverridden' | 'priorityOverridden'>;

/** While PENDING, category and priority are provisional keyword guesses (contract v1.1). */
export const isClassifying = (t: Pick<AiFields, 'aiStatus'>) => t.aiStatus === 'PENDING';

/**
 * Contract-derived rule: AI failed and a human hasn't set both fields yet. Once the admin overrides
 * category and priority the ticket counts as triaged, even though aiStatus stays FAILED.
 */
export const needsManualTriage = (t: AiFields) =>
  t.aiStatus === 'FAILED' && !(t.categoryOverridden && t.priorityOverridden);
