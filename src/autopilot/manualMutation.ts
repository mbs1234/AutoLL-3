import {
  type RequestControl,
  RequestNotSent,
  UnknownMutationOutcome,
} from '@/api/client';
import type { DasBooking, LightningLane } from '@/api/itinerary';
import type { Offer } from '@/api/ll';
import { parkDate } from '@/datetime';

import { actionWasRejected, outcomeIsUnknown } from './autobook';
import {
  acquire,
  keepAlive,
  leaseKey,
  mutationId,
  quarantine,
  release,
  resolveDoubt,
  startWhileHeld,
} from './lease';
import {
  MAX_MUTATION_MS,
  type MutationEvidence,
  MutationOperation,
  mutationControl,
} from './mutation';

export interface ManualMutation {
  keys: string[];
  evidence: MutationEvidence;
}

export function bookingMutation(offer: Offer): ManualMutation {
  const booking = offer.booking;
  return {
    keys: [
      ...new Set([
        leaseKey(
          booking?.facilityId ?? offer.experience.id,
          parkDate(offer.start)
        ),
        leaseKey(offer.experience.id, parkDate(offer.start)),
      ]),
    ],
    evidence: {
      kind: !booking
        ? 'book'
        : booking.facilityId === offer.experience.id
          ? 'modify'
          : 'swap',
      from: booking ? String(booking.start.time) : undefined,
      to: String(offer.start.time),
      gaining:
        booking && booking.facilityId !== offer.experience.id
          ? offer.experience.id
          : undefined,
      reservationIds: booking
        ? [booking.id, ...booking.guests.map(g => g.entitlementId)]
        : [],
    },
  };
}

export function cancellationMutation(
  booking: LightningLane | DasBooking
): ManualMutation {
  return {
    keys: [leaseKey(booking.facilityId, parkDate(booking.start))],
    evidence: {
      kind: 'cancel',
      to: '',
      reservationIds: [booking.id, ...booking.guests.map(g => g.entitlementId)],
    },
  };
}

/** A manual action owns exactly the same conflict set as either engine. */
export async function runManualMutation<T>(
  { keys, evidence }: ManualMutation,
  send: (control: RequestControl) => Promise<T>,
  {
    signal,
    authorize = () => true,
  }: { signal?: AbortSignal; authorize?: () => boolean } = {}
): Promise<T> {
  const id = mutationId(`manual-${evidence.kind}`);
  let pageOnlyProtection = false;
  const releaseSafely = async () => {
    if (pageOnlyProtection) return;
    try {
      await release(keys, id);
    } catch (error) {
      console.error(error);
    }
  };
  const resolveSafely = async () => {
    try {
      await resolveDoubt(keys[0]!, id);
      pageOnlyProtection = false;
    } catch (error) {
      console.error(error);
    }
  };
  let stopRenewal = () => {};
  let rejectAbandoned: (error: Error) => void = () => {};
  const abandoned = new Promise<never>((_, reject) => {
    rejectAbandoned = reject;
  });
  const protect = async (operation: MutationOperation) => {
    const result = await quarantine(
      keys[0]!,
      { id, ...evidence, blockingKeys: keys },
      operation.dispatchedAt
    );
    pageOnlyProtection = !result.durable;
    return new UnknownMutationOutcome(
      result.durable
        ? 'Disney did not return a definite result. Check Plans and resolve the protected change before trying again.'
        : 'Disney did not return a definite result. Protection is only available in this page; keep it open and check Plans.'
    );
  };
  const operation = new MutationOperation({
    id,
    kind: evidence.kind,
    abandonAt: Date.now() + MAX_MUTATION_MS,
    onAbandon: async current => {
      try {
        const error = current.dispatched
          ? await protect(current)
          : new RequestNotSent('Action stopped before send');
        rejectAbandoned(error);
      } finally {
        stopRenewal();
        await releaseSafely();
      }
    },
  });
  const abort = () => operation.abandon('unmounted');
  signal?.addEventListener('abort', abort, { once: true });
  // Attach the rejection observer before acquisition, which may itself wait.
  const work = (async () => {
    try {
      if (signal?.aborted || !authorize()) {
        throw new RequestNotSent('Action stopped before send');
      }
      if (!(await acquire(keys, id))) {
        throw new RequestNotSent(
          'This reservation is busy or has an unresolved change. Check Plans before trying again.'
        );
      }
      stopRenewal = keepAlive(keys, id, () =>
        operation.abandon('lease-refused')
      );
      const control = mutationControl(operation, {
        evidence,
        authorize,
        start: async (allowed, dispatch) => {
          const started = await startWhileHeld(keys, id, allowed, dispatch);
          if (!started.started) {
            throw new RequestNotSent(
              'Reservation protection changed before send'
            );
          }
          return started.value;
        },
      });
      let result: T;
      try {
        result = await send(control);
      } catch (error) {
        operation.settle();
        await operation.waitForAbandonment();
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        const refused = status !== undefined && status >= 400 && status < 500;
        if (
          outcomeIsUnknown(error) ||
          (operation.dispatched && !refused && !actionWasRejected(error))
        ) {
          throw await protect(operation);
        }
        await resolveSafely();
        throw error;
      }
      operation.settle();
      await operation.waitForAbandonment();
      // Late success/rejection resolves only this operation, never a newer one.
      await resolveSafely();
      return result;
    } finally {
      operation.settle();
      signal?.removeEventListener('abort', abort);
      stopRenewal();
      await releaseSafely();
    }
  })();
  return Promise.race([work, abandoned]);
}
