/**
 * Tiny in-process job queue for ticket classification.
 * - de-duplicates ticket ids already queued or running
 * - bounded concurrency so a burst of tickets doesn't burst the LLM rate limit
 * - recoverPending() re-queues tickets left PENDING by a restart
 *
 * Production evolution: swap for a durable queue (BullMQ/pg-boss) behind the same interface.
 */
export type ClassificationHandler = (ticketId: string) => Promise<void>;

export class ClassificationQueue {
  private readonly pending: string[] = [];
  private readonly known = new Set<string>();
  private running = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly handler: ClassificationHandler,
    private readonly concurrency = 2,
    private readonly onError: (ticketId: string, err: unknown) => void = () => {},
  ) {}

  enqueue(ticketId: string): void {
    if (this.known.has(ticketId)) return;
    this.known.add(ticketId);
    this.pending.push(ticketId);
    // Defer so the HTTP response that created the ticket is sent first.
    setImmediate(() => this.pump());
  }

  /** Resolves when nothing is queued or running. Used by tests and graceful shutdown. */
  onIdle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.running += 1;
      this.handler(id)
        .catch((err) => this.onError(id, err))
        .finally(() => {
          this.running -= 1;
          this.known.delete(id);
          this.pump();
          if (this.running === 0 && this.pending.length === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach((w) => w());
          }
        });
    }
  }
}
