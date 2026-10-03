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
  quarantinedAt,
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
      // Plans settle a new booking by its guests: a booking has no identity of
      // its own until Disney's answer, which is the thing that may be lost.
      ...(booking
        ? {}
        : { guestIds: offer.guests.eligible.map(guest => guest.id) }),
    },
  };
}

/**
 * Cancelling `guests` (all of them when omitted) from one reservation.
 *
 * The evidence names only what the cancellation removes. Removing some guests
 * leaves the reservation and everyone else on it in place, so naming those as
 * well would read as "still there" and the doubt could never see its answer.
 */
export function cancellationMutation(
  booking: LightningLane | DasBooking,
  guests: readonly { entitlementId: string }[] = booking.guests
): ManualMutation {
  const all = guests.length >= booking.guests.length;
  return {
    keys: [leaseKey(booking.facilityId, parkDate(booking.start))],
    evidence: {
      kind: 'cancel',
      to: '',
      reservationIds: all
        ? [booking.id, ...booking.guests.map(g => g.entitlementId)]
        : guests.map(g => g.entitlementId),
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
      let acquired: boolean;
      try {
        acquired = await acquire(keys, id);
      } catch (error) {
        // The lease could not be written, so the change could not be
        // protected. Said as what it is: "Unknown error occurred" sent people
        // looking at Disney for a problem on the phone.
        console.error(error);
        throw new RequestNotSent(
          "Nothing was sent: this phone's storage for AutoLL is full or unavailable, so the change could not be protected. Free some space and try again."
        );
      }
      if (!acquired) {
        // Two different situations, and only one of them has anything for the
        // person to resolve. A lease is held by Autopilot, a search, or an
        // attempt a reload interrupted, and lapses by itself within two
        // minutes; an unresolved change waits for plans or for the person.
        throw new RequestNotSent(
          keys.some(key => quarantinedAt(key) !== undefined)
            ? 'Nothing was sent: this reservation has an unresolved change. Check Plans, then resolve it below before trying again.'
            : 'Nothing was sent: another AutoLL action is changing this reservation right now. Try again in a minute or two.'
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
