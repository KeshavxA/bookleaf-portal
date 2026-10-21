import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';
import { TICKET_STATUSES, type AdminTicket, type Draft, type TicketStatus } from '@/api/types';
import { Button } from '@/components/Button';
import { Field, Select, Textarea } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/Spinner';
import { Banner } from '@/components/States';
import { useNow } from '@/hooks/useNow';
import { needsManualTriage } from '@/lib/aiState';
import { formatRelative } from '@/lib/format';
import { STATUS_LABEL } from '@/lib/labels';
import { errorSummary } from '@/lib/serverErrors';
import { useDraft, useRedraftOnAuthorMessage, useRegenerateDraft, useSendReply } from './hooks';

export function DraftReplyPanel({ ticket }: { ticket: AdminTicket }) {
  const now = useNow();
  const draftQuery = useDraft(ticket.id);
  const regenerate = useRegenerateDraft(ticket.id);
  const send = useSendReply(ticket.id);
  useRedraftOnAuthorMessage(ticket);

  const [body, setBody] = useState('');
  const [edited, setEdited] = useState(false);
  const [statusOnSend, setStatusOnSend] = useState<TicketStatus | ''>('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  // generatedAt of the draft last copied into the textarea, so the same draft is never re-applied
  // over the admin's text (e.g. after sending, or when the query re-renders).
  const appliedRef = useRef<string | null>(null);

  const draft = draftQuery.data?.draft ?? null;
  const loading = draftQuery.isPending || regenerate.isPending;
  const refreshing = draftQuery.isFetching && !draftQuery.isPending;
  const aiError = draftQuery.data?.error;
  const unavailable = !loading && !refreshing && (draftQuery.isError || !draft);
  const hasOwnText = edited && body.trim().length > 0;
  // A newer draft (after a category change or an author message) that we held back to protect edits.
  const newerDraft = draft && draft.generatedAt !== appliedRef.current && hasOwnText ? draft : null;

  const apply = (d: Draft) => {
    appliedRef.current = d.generatedAt;
    setBody(d.body);
    setEdited(false);
  };

  useEffect(() => {
    if (!draft || appliedRef.current === draft.generatedAt || hasOwnText) return;
    apply(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.generatedAt]);

  const onRegenerate = () => {
    if (hasOwnText && !window.confirm('Replace your edited reply with a new AI draft?')) return;
    regenerate.mutate(undefined, { onSuccess: (data) => data.draft && apply(data.draft) });
  };

  const trimmed = body.trim();
  const onSend = () => {
    if (!trimmed) return;
    send.mutate(
      { body: trimmed, ...(statusOnSend && { status: statusOnSend }) },
      {
        onSuccess: () => {
          setBody('');
          setEdited(false);
          setStatusOnSend('');
          setSentAt(Date.now());
        },
      },
    );
  };

  return (
    <Panel
      title="Reply to author"
      aside={
        refreshing ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500" role="status">
            <Spinner className="h-3 w-3" /> Updating draft…
          </span>
        ) : draft && !loading ? (
          <span className="text-xs text-slate-500">AI draft · {formatRelative(draft.generatedAt, now)}</span>
        ) : null
      }
    >
      <div className="space-y-3">
        {needsManualTriage(ticket) && (
          <p className="text-xs font-medium text-amber-800">⚠ This ticket needs manual triage. Check the category and priority before replying.</p>
        )}
        {unavailable && (
          <Banner tone="info" title="AI drafting is unavailable, write your reply manually.">
            {(aiError?.message || draftQuery.isError) && (
              <span className="text-xs opacity-80">
                {aiError?.message ?? errorMessage(draftQuery.error, 'The draft service could not be reached.')} You can try
                Regenerate again later.
              </span>
            )}
          </Banner>
        )}
        {newerDraft && (
          <Banner tone="info">
            A new AI draft is available, based on the latest changes to this ticket.{' '}
            <button type="button" className="font-medium underline hover:no-underline" onClick={() => apply(newerDraft)}>
              Replace my text with it
            </button>
          </Banner>
        )}
        {regenerate.isError && <Banner tone="error">{errorMessage(regenerate.error, 'Could not regenerate the draft.')}</Banner>}
        {send.isError && <Banner tone="error">{errorSummary(send.error, 'Your reply was not sent.')} Your text is still here.</Banner>}
        {sentAt && now - sentAt < 60_000 && !send.isPending && (
          <Banner tone="success">
            Reply sent. {ticket.author.name} can see it now. Status: {STATUS_LABEL[ticket.status]}
            {ticket.assignee ? ` · Assigned to ${ticket.assignee.name}` : ''}.
          </Banner>
        )}

        {loading ? (
          <div role="status" aria-label="Generating AI draft" className="space-y-2 rounded-md border border-slate-200 p-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <span className="sr-only">Generating a draft reply…</span>
          </div>
        ) : (
          <Field label="Reply" hideLabel hint={draft ? 'Review and edit the draft before sending. The author sees exactly this text.' : undefined}>
            {(p) => (
              <Textarea
                {...p}
                rows={12}
                value={body}
                placeholder="Write your reply to the author…"
                disabled={send.isPending}
                onChange={(e) => {
                  setBody(e.target.value);
                  setEdited(true);
                }}
              />
            )}
          </Field>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Set status on send" className="min-w-40 flex-1">
            {(p) => (
              <Select {...p} value={statusOnSend} disabled={send.isPending} onChange={(e) => setStatusOnSend(e.target.value as TicketStatus | '')}>
                {/* Per the contract, no status means OPEN moves to IN_PROGRESS and an unassigned ticket goes to you. */}
                <option value="">
                  {ticket.status === 'OPEN' ? 'Default (moves to In Progress)' : `Keep as ${STATUS_LABEL[ticket.status]}`}
                </option>
                {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="secondary" onClick={onRegenerate} loading={regenerate.isPending} disabled={draftQuery.isPending || send.isPending}>
            Regenerate
          </Button>
          <Button onClick={onSend} loading={send.isPending} disabled={!trimmed || loading}>
            Send reply
          </Button>
        </div>
      </div>
    </Panel>
  );
}
