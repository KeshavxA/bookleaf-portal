import { useState } from 'react';
import { errorMessage } from '@/api/client';
import { TICKET_STATUSES, type AdminTicket, type TicketStatus } from '@/api/types';
import { Button } from '@/components/Button';
import { Field, Select, Textarea } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { Banner } from '@/components/States';
import { useAuth } from '@/features/auth/AuthContext';
import { formatDateTime } from '@/lib/format';
import { errorSummary } from '@/lib/serverErrors';
import { STATUS_LABEL } from '@/lib/labels';
import { useAddNote, useAdmins, useAssignToMe, useUpdateTicket } from './hooks';

export function ManagementPanel({ ticket }: { ticket: AdminTicket }) {
  const { user } = useAuth();
  const update = useUpdateTicket(ticket.id);
  const reassign = useUpdateTicket(ticket.id);
  const assignToMe = useAssignToMe(ticket.id);
  const admins = useAdmins();
  const mine = ticket.assignee?.id === user?.id;
  const error = update.error ?? reassign.error ?? assignToMe.error;

  return (
    <Panel title="Ticket management">
      <div className="space-y-3">
        {error && <Banner tone="error">{errorMessage(error, 'The change could not be saved.')}</Banner>}
        <Field label="Status">
          {(p) => (
            <Select
              {...p}
              value={ticket.status}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })}
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end gap-2">
          <Field label="Assignee" className="flex-1">
            {(p) => (
              <Select
                {...p}
                value={ticket.assignee?.id ?? ''}
                disabled={reassign.isPending || assignToMe.isPending || admins.isPending}
                onChange={(e) => reassign.mutate({ assigneeId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {/* Keep the current assignee selectable even if the admins list hasn't loaded. */}
                {ticket.assignee && !admins.data?.some((a) => a.id === ticket.assignee!.id) && (
                  <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
                )}
                {admins.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.id === user?.id ? ' (you)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="secondary" onClick={() => assignToMe.mutate()} loading={assignToMe.isPending} disabled={mine || reassign.isPending}>
            {mine ? 'Assigned to you' : 'Assign to me'}
          </Button>
        </div>
      </div>
      <InternalNotes ticket={ticket} />
    </Panel>
  );
}

function InternalNotes({ ticket }: { ticket: AdminTicket }) {
  const [body, setBody] = useState('');
  const add = useAddNote(ticket.id);
  const notes = ticket.internalNotes;
  const trimmed = body.trim();

  return (
    <section aria-labelledby="internal-notes-heading" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
      <h3 id="internal-notes-heading" className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <span aria-hidden="true">🔒</span> Internal notes
      </h3>
      <p className="text-xs text-amber-800">Internal only, not visible to the author.</p>
      {notes.length === 0 ? (
        <p className="mt-2 text-xs text-amber-900/70">No notes yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded border border-amber-200 bg-white/70 px-2.5 py-2 text-sm">
              <div className="flex justify-between gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{n.adminName}</span>
                <time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) add.mutate(trimmed, { onSuccess: () => setBody('') });
        }}
      >
        {add.isError && <Banner tone="error">{errorSummary(add.error, 'The note was not saved.')}</Banner>}
        <Field label="Add an internal note" hideLabel>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add an internal note for the team…"
              disabled={add.isPending}
              className="ring-amber-300"
            />
          )}
        </Field>
        <Button type="submit" size="sm" variant="secondary" loading={add.isPending} disabled={!trimmed}>
          Add internal note
        </Button>
      </form>
    </section>
  );
}
