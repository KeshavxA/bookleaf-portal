import { errorMessage } from '@/api/client';
import { CATEGORIES, PRIORITIES, type AdminTicket } from '@/api/types';
import { Badge } from '@/components/Badge';
import { Field, Select } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { Spinner } from '@/components/Spinner';
import { Banner } from '@/components/States';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/labels';
import { useUpdateTicket } from './hooks';

/** Shows whether the current value is the AI's suggestion or an admin override. */
function Provenance({ aiValue, overridden }: { aiValue?: string; overridden: boolean }) {
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
  const ai = ticket.aiSuggestion;
  // The server flag sticks once set; if the admin picks the AI's value again it's no longer an override in practice.
  const categoryOverridden = ticket.categoryOverridden && (!ai || ticket.category !== ai.category);
  const priorityOverridden = ticket.priorityOverridden && (!ai || ticket.priority !== ai.priority);

  return (
    <Panel
      title="AI triage"
      aside={
        ticket.aiStatus === 'PENDING' ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
            <Spinner className="h-3.5 w-3.5" /> Analysing…
          </span>
        ) : null
      }
    >
      {ticket.aiStatus === 'FAILED' && (
        <Banner tone="warning" title="Needs manual triage" className="mb-3">
          AI couldn't classify this ticket. Set the category and priority yourself.
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
          <Provenance aiValue={ai ? CATEGORY_LABEL[ai.category] : undefined} overridden={categoryOverridden} />
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
          <Provenance aiValue={ai ? PRIORITY_LABEL[ai.priority] : undefined} overridden={priorityOverridden} />
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
