/**
 * Minimal consecutive-failure circuit breaker.
 *
 * CLOSED    - calls flow; `threshold` consecutive upstream failures -> OPEN
 * OPEN      - calls fail fast until `cooldownMs` has elapsed -> HALF_OPEN
 * HALF_OPEN - exactly one probe call is let through; success -> CLOSED, failure -> OPEN
 *
 * When the LLM provider is down this stops every new ticket from paying
 * 15s+ of timeouts before falling back, and stops us hammering a struggling API.
 */
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  threshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private state: BreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Returns true if a call may proceed. Transitions OPEN -> HALF_OPEN when the cooldown has passed. */
  tryAcquire(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (this.now() - this.openedAt < this.opts.cooldownMs) return false;
      this.state = "HALF_OPEN";
      this.probeInFlight = false;
    }
    // HALF_OPEN: allow a single probe.
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  onSuccess(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
  }

  onFailure(): void {
    this.probeInFlight = false;
    if (this.state === "HALF_OPEN") {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.opts.threshold) this.trip();
  }

  /** A call that finished without telling us anything about upstream health (e.g. a 400). */
  onNeutral(): void {
    this.probeInFlight = false;
    if (this.state === "HALF_OPEN") this.state = "CLOSED";
  }

  getState(): BreakerState {
    return this.state;
  }

  private trip(): void {
    this.state = "OPEN";
    this.openedAt = this.now();
    this.consecutiveFailures = 0;
  }
}
