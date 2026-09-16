import type { ActionKind } from './autobook';
import { RENEW_INTERVAL_MS } from './lease';
import type { DoubtKind } from './lease';
import { TICK_DEADLINE_MS } from './schedule';

/** The poller's deadline plus one observable lease-renewal interval. */
export const MAX_MUTATION_MS = TICK_DEADLINE_MS + RENEW_INTERVAL_MS;

export interface MutationEvidence {
  kind: DoubtKind;
  from?: string;
  to: string;
  gaining?: string;
}

export type MutationAbandonReason =
  | 'deadline'
  | 'lease-refused'
  | 'stopped'
  | 'unmounted';

interface MutationOptions {
  id: string;
  kind: ActionKind;
  /** Absolute wall-clock deadline, derived from the tick or commit start. */
  abandonAt: number;
  onAbandon?: (
    operation: MutationOperation,
    reason: MutationAbandonReason
  ) => void | Promise<void>;
}

/**
 * One mutation's identity and lifecycle across helpers, transport and doubt.
 *
 * The old implementation inferred the same boundary four ways: a ledger lock
 * meant "sent", a timer meant "live", similar evidence meant "same request",
 * and a lease meant both current work and historical doubt. This object is the
 * one answer instead. `markDispatched` is called only by `ApiClient.request`, on
 * the instruction immediately before `fetchJson` starts.
 */
export class MutationOperation {
  readonly id: string;
  readonly kind: ActionKind;
  readonly abandonAt: number;
  readonly controller = new AbortController();
  evidence?: MutationEvidence;

  #dispatched = false;
  #dispatchedAt?: number;
  #abandoned = false;
  #abandonReason?: MutationAbandonReason;
  #settled = false;
  #timer: ReturnType<typeof setTimeout>;
  #abandonment: Promise<void> = Promise.resolve();
  readonly #onAbandon?: MutationOptions['onAbandon'];

  constructor({ id, kind, abandonAt, onAbandon }: MutationOptions) {
    this.id = id;
    this.kind = kind;
    this.abandonAt = abandonAt;
    this.#onAbandon = onAbandon;
    this.#timer = setTimeout(
      () => this.abandon('deadline'),
      Math.max(0, abandonAt - Date.now())
    );
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get dispatched(): boolean {
    return this.#dispatched;
  }

  get dispatchedAt(): number | undefined {
    return this.#dispatchedAt;
  }

  get abandoned(): boolean {
    return this.#abandoned;
  }

  get abandonReason(): MutationAbandonReason | undefined {
    return this.#abandonReason;
  }

  get settled(): boolean {
    return this.#settled;
  }

  /** The exact boundary after sensor generation and immediately before fetch. */
  markDispatched(evidence?: MutationEvidence, at = Date.now()): boolean {
    if (
      this.#dispatched ||
      this.#settled ||
      this.#abandoned ||
      this.signal.aborted
    ) {
      return false;
    }
    this.#dispatched = true;
    this.#dispatchedAt = at;
    this.evidence = evidence;
    return true;
  }

  /** Stop anything not yet sent, or convert sent work into an explicit doubt. */
  abandon(reason: MutationAbandonReason): void {
    if (this.#settled || this.#abandoned) return;
    this.#abandoned = true;
    this.#abandonReason = reason;
    clearTimeout(this.#timer);
    this.controller.abort(reason);
    const work = Promise.resolve().then(() => this.#onAbandon?.(this, reason));
    // A request can remain hung forever after abandonment, so there may be no
    // caller left to await this. Mark the rejection observed here while keeping
    // the original promise for callers that do return and need the failure.
    void work.catch(() => undefined);
    this.#abandonment = work;
  }

  /** The request produced a classified result; no timer may act on it now. */
  settle(): void {
    if (this.#settled) return;
    this.#settled = true;
    clearTimeout(this.#timer);
  }

  async waitForAbandonment(): Promise<void> {
    await this.#abandonment;
  }
}
