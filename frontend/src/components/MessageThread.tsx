import type { Attachment, Message } from '@/api/types';
import { useNewIds } from '@/hooks/useChangeCue';
import { cn } from '@/lib/cn';
import { formatBytes, formatDateTime } from '@/lib/format';

interface Props {
  /** The original query, shown as the first entry in the thread. */
  original: { authorName: string; body: string; createdAt: string; attachments: Attachment[] };
  messages: Message[];
  /** Whose perspective: changes the "You" label. */
  viewer: 'AUTHOR' | 'ADMIN';
  emptyHint?: string;
}

export function MessageThread({ original, messages, viewer, emptyHint }: Props) {
  const fresh = useNewIds(messages.map((m) => m.id));
  return (
    <ol className="space-y-4" aria-label="Conversation">
      <ThreadItem
        side="AUTHOR"
        name={viewer === 'AUTHOR' ? 'You' : original.authorName}
        tag="Original query"
        body={original.body}
        createdAt={original.createdAt}
        attachments={original.attachments}
      />
      {messages.map((m) => (
        <ThreadItem
          key={m.id}
          side={m.senderType}
          name={viewer === m.senderType && viewer === 'AUTHOR' ? 'You' : m.senderName}
          tag={m.senderType === 'ADMIN' ? 'BookLeaf Support' : undefined}
          body={m.body}
          createdAt={m.createdAt}
          highlight={fresh.has(m.id)}
        />
      ))}
      {messages.length === 0 && emptyHint && (
        <li className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">{emptyHint}</li>
      )}
    </ol>
  );
}

function ThreadItem(props: {
  side: 'AUTHOR' | 'ADMIN';
  name: string;
  tag?: string;
  body: string;
  createdAt: string;
  attachments?: Attachment[];
  highlight?: boolean;
}) {
  const admin = props.side === 'ADMIN';
  return (
    <li className={cn('flex', admin ? 'justify-start' : 'justify-end')}>
      <article
        className={cn(
          'w-full max-w-2xl rounded-lg border px-4 py-3 shadow-sm',
          admin ? 'border-brand-100 bg-brand-50' : 'border-slate-200 bg-white',
          props.highlight && 'animate-flash',
        )}
      >
        <header className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">{props.name}</span>
          {props.tag && <span>{props.tag}</span>}
          <time dateTime={props.createdAt} className="ml-auto">
            {formatDateTime(props.createdAt)}
          </time>
          {props.highlight && <span className="font-medium text-emerald-700">New</span>}
        </header>
        <p className="whitespace-pre-wrap text-sm text-slate-800">{props.body}</p>
        {props.attachments && props.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
            {props.attachments.map((a, i) => (
              <li key={`${a.name}-${i}`} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                📎 {a.name} <span className="text-slate-500">({formatBytes(a.size)})</span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
}
