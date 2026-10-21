import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { errorMessage, fieldErrors } from '@/api/client';
import type { Attachment, AuthorTicket } from '@/api/types';
import { PageHeader } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { Banner } from '@/components/States';
import { useBooks } from '@/features/books/useBooks';
import { AttachmentPicker } from './AttachmentPicker';
import { useCreateTicket } from './hooks';
import { GENERAL_BOOK, ticketSchema, type TicketFormValues } from './schema';

export function NewTicketPage() {
  const [params] = useSearchParams();
  const [created, setCreated] = useState<AuthorTicket | null>(null);

  if (created) return <SubmittedState ticket={created} onAnother={() => setCreated(null)} />;
  return <TicketForm initialBookId={params.get('bookId') ?? ''} onCreated={setCreated} />;
}

function TicketForm({ initialBookId, onCreated }: { initialBookId: string; onCreated: (t: AuthorTicket) => void }) {
  const books = useBooks();
  const create = useCreateTicket();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { bookId: initialBookId, subject: '', description: '' },
  });
  const descriptionLength = watch('description')?.trim().length ?? 0;

  const onSubmit = async (values: TicketFormValues) => {
    try {
      const ticket = await create.mutateAsync({
        bookId: values.bookId === GENERAL_BOOK ? null : values.bookId,
        subject: values.subject.trim(),
        description: values.description.trim(),
        attachments: attachments.length ? attachments : undefined,
      });
      onCreated(ticket);
    } catch (e) {
      const fields = fieldErrors(e);
      for (const name of ['bookId', 'subject', 'description'] as const) {
        if (fields[name]) setError(name, { message: fields[name] });
      }
      setError('root', { message: errorMessage(e, 'We could not submit your query. Please try again.') });
    }
  };

  return (
    <>
      <PageHeader title="Submit a query" description="Our support team usually replies within one business day." />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-2xl space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {errors.root?.message && <Banner tone="error">{errors.root.message}</Banner>}

        <Field
          label="Which book is this about?"
          error={errors.bookId?.message}
          hint={books.isError ? 'We could not load your books. You can still raise a general query.' : undefined}
        >
          {(p) => (
            <Select {...p} disabled={books.isPending} {...register('bookId')}>
              <option value="">{books.isPending ? 'Loading your books…' : 'Select a book'}</option>
              <option value={GENERAL_BOOK}>General / Account Level</option>
              {books.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Subject" error={errors.subject?.message}>
          {(p) => <Input {...p} maxLength={120} placeholder="e.g. Royalty for Q3 not received" {...register('subject')} />}
        </Field>

        <Field
          label="Describe your query"
          error={errors.description?.message}
          hint={`${descriptionLength}/5000 · Include dates, amounts and platform names where you can.`}
        >
          {(p) => <Textarea {...p} rows={7} maxLength={5000} {...register('description')} />}
        </Field>

        <AttachmentPicker value={attachments} onChange={setAttachments} disabled={create.isPending} />

        <div className="flex items-center gap-3 border-t border-slate-100 pt-5">
          <Button type="submit" loading={create.isPending}>
            Submit query
          </Button>
          <Link to="/tickets" className="text-sm text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}

function SubmittedState({ ticket, onAnother }: { ticket: AuthorTicket; onAnother: () => void }) {
  return (
    <div className="max-w-2xl rounded-lg border border-emerald-200 bg-emerald-50 p-6" role="status">
      <h1 className="text-lg font-semibold text-emerald-900">Query submitted: {ticket.ticketNumber}</h1>
      <p className="mt-1 text-sm text-emerald-900">
        Thanks for getting in touch. Our team will reply on the ticket, and you'll see it right away with no need
        to refresh.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          to={`/tickets/${ticket.id}`}
          className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          View ticket
        </Link>
        <Button variant="secondary" onClick={onAnother}>
          Submit another query
        </Button>
      </div>
    </div>
  );
}
