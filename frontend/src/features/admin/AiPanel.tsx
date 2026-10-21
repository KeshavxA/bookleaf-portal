import { errorMessage } from '@/api/client';
import { CATEGORIES, PRIORITIES, type AdminTicket } from '@/api/types';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, Select } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { Banner } from '@/components/States';
import { isClassifying, needsManualTriage } from '@/lib/aiState';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/labels';
import { ClassifyingBadge } from './AiBadges';
import { useRetryTriage, useUpdateTicket } from './hooks';

/** Shows whether the current value is provisional, the AI's suggestion, or an admin override. */
function Provenance({ aiValue, overridden, classifying }: { aiValue?: string; overridden: boolean; classifying: boolean }) {
  if (classifying && !overridden) {
    return <p className="mt-1 text-xs text-slate-500">Provisional (keyword-based) until AI classification finishes.</p>;
  }
  if (overridden) {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <Badge className="bg-slate-800 text-white ring-slate-800">Overridden</Badge>
        {aiValue ? <span>AI suggested: {aiValue}</span> : <span>Set manually</span>}
      </p>
    );
  }
  if (!aiValue) return null;
  return (
    <p className="mt-1">
      <Badge className="bg-violet-50 text-violet-800 ring-violet-200">✨ AI suggested</Badge>
    </p>
  );
}

export function AiPanel({ ticket }: { ticket: AdminTicket }) {
  const update = useUpdateTicket(ticket.id);
  const retry = useRetryTriage(ticket.id);
  const ai = ticket.aiSuggestion;
  const classifying = isClassifying(ticket);
  const manualTriage = needsManualTriage(ticket);
  // The server flag sticks once set; if the admin picks the AI's value again it's no longer an override in practice.
  const categoryOverridden = ticket.categoryOverridden && (!ai || ticket.category !== ai.category);
  const priorityOverridden = ticket.priorityOverridden && (!ai || ticket.priority !== ai.priority);

  return (
    <Panel
      title="AI triage"
      aside={
        classifying ? (
          <span role="status">
            <ClassifyingBadge />
          </span>
        ) : null
      }
    >
      {manualTriage && (
        <Banner tone="warning" title="Needs manual triage" className="mb-3">
          <p>AI couldn't classify this ticket. Set the category and priority yourself, or retry the AI.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => retry.mutate()}
            loading={retry.isPending}
            disabled={update.isPending}
          >
            Retry AI triage
          </Button>
        </Banner>
      )}
      {retry.isError && (
        <Banner tone="error" className="mb-3">
          {errorMessage(retry.error, 'Could not start AI triage.')}
        </Banner>
      )}
      {update.isError && (
        <Banner tone="error" className="mb-3">
          {errorMessage(update.error, 'The change could not be saved.')} The previous value has been restored.
        </Banner>
      )}
      <div className="space-y-3">
        <div>
          <Field label="Category">
            {(p) => (
              <Select
                {...p}
                value={ticket.category}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ category: e.target.value as AdminTicket['category'] })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Provenance aiValue={ai ? CATEGORY_LABEL[ai.category] : undefined} overridden={categoryOverridden} classifying={classifying} />
        </div>
        <div>
          <Field label="Priority">
            {(p) => (
              <Select
                {...p}
                value={ticket.priority}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ priority: e.target.value as AdminTicket['priority'] })}
              >
                {PRIORITIES.map((pr) => (
                  <option key={pr} value={pr}>
                    {PRIORITY_LABEL[pr]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Provenance aiValue={ai ? PRIORITY_LABEL[ai.priority] : undefined} overridden={priorityOverridden} classifying={classifying} />
        </div>
        {ai?.reasoning && (
          <figure className="rounded-md bg-violet-50/60 px-3 py-2">
            <figcaption className="text-xs font-medium text-violet-900">AI reasoning</figcaption>
            <blockquote className="mt-0.5 text-sm text-slate-700">{ai.reasoning}</blockquote>
          </figure>
        )}
      </div>
    </Panel>
  );
}
