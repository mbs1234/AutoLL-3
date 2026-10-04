import { use, useEffect, useId, useRef, useState } from 'react';

import { APP_NAME } from '@/appIdentity';
import { attractionName } from '@/autopilot/attractionName';
import { resolveDoubt } from '@/autopilot/lease';
import type { QuarantinedMutation } from '@/autopilot/lease';
import Button from '@/components/Button';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ResortContext from '@/contexts/ResortContext';

import { description } from './protectionDescription';

/**
 * Whether plans can settle this by themselves.
 *
 * A booking by the guests it was for, the others by the reservation they
 * changed. Without that evidence only a person can, which is not the same as
 * the entry being left by an older version: that is only true without a kind.
 */
function settlesByItself(doubt: QuarantinedMutation): boolean {
  if (doubt.kind === 'book') return !!doubt.guestIds?.length;
  if (doubt.kind) return !!doubt.reservationIds?.length;
  return false;
}

/**
 * A booking that a complete read, 30 seconds or more after it was sent, still
 * did not show. Not proof, so it is not cleared for the person; but likely
 * enough that clearing it takes one tap instead of two.
 */
function probablyNotMade(doubt: QuarantinedMutation): boolean {
  return doubt.kind === 'book' && doubt.notSeenAt !== undefined;
}

/** Visible, operation-specific protection with an explicit manual escape. */
export default function QuarantinePanel({
  doubts,
}: {
  doubts: QuarantinedMutation[];
}) {
  const { experiences } = use(ExperiencesContext);
  const resort = use(ResortContext);
  const [confirming, setConfirming] = useState<string>();
  const [clearing, setClearing] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const warningId = useId();
  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus();
  }, [confirming]);
  if (!doubts.length) return null;

  const nameOf = (id: string) => attractionName(id, experiences, resort);
  const identity = (doubt: QuarantinedMutation) => `${doubt.key}:${doubt.id}`;

  async function clear(doubt: QuarantinedMutation) {
    const item = identity(doubt);
    setClearing(item);
    setErrors(current => {
      const next = { ...current };
      delete next[item];
      return next;
    });
    try {
      await resolveDoubt(doubt.key, doubt.id, 'cleared');
      setConfirming(undefined);
    } catch (caught) {
      setErrors(current => ({
        ...current,
        [item]: caught instanceof Error ? caught.message : String(caught),
      }));
    } finally {
      setClearing(undefined);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-sm bg-red-100 p-2 text-sm text-red-900"
    >
      <h3 id={headingId} className="font-semibold">
        {doubts.length} unresolved Lightning Lane change
        {doubts.length === 1 ? '' : 's'} protected
      </h3>
      <p className="mt-1">
        Disney did not return a definite answer. {APP_NAME} will not book, move,
        swap, or cancel the affected attractions until Plans show what happened
        or you confirm it. A booking clears when Plans show it, a cancellation
        when Plans no longer show the cancelled passes, and a move or a swap
        when they show the exact requested result. A booking Plans still do not
        show after 30 seconds probably did not go through, and one tap clears
        it.
      </p>
      <ul className="mt-2 space-y-2">
        {doubts.map(doubt => (
          <li className="rounded-sm bg-white/60 p-2" key={identity(doubt)}>
            <p>{description(doubt, nameOf)}</p>
            {!settlesByItself(doubt) && (
              <p className="mt-1 font-semibold" role="status">
                {doubt.kind
                  ? 'This entry cannot clear automatically.'
                  : `This entry was saved by an older ${APP_NAME} version and cannot clear automatically.`}{' '}
                Check Disney Plans, then resolve it here.
              </p>
            )}
            {probablyNotMade(doubt) && (
              <p className="mt-1 font-semibold" role="status">
                Plans still do not show this booking. It probably did not go
                through.
              </p>
            )}
            {!doubt.durable && (
              <p className="mt-1 font-semibold" role="status">
                This protection is available only while this page remains open.
                Keep other {APP_NAME} tabs closed and check Disney Plans now.
              </p>
            )}
            {probablyNotMade(doubt) ? (
              <Button
                type="small"
                className="mt-2"
                disabled={clearing === identity(doubt)}
                onClick={() => void clear(doubt)}
              >
                {clearing === identity(doubt)
                  ? 'Clearing…'
                  : 'Clear this protection'}
              </Button>
            ) : confirming === identity(doubt) ? (
              <div
                aria-labelledby={warningId}
                className="mt-2"
                role="alertdialog"
              >
                <p id={warningId}>
                  Clear this only after checking Disney's Plans. Clearing it
                  allows another automatic change to this reservation.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    ref={confirmButtonRef}
                    type="small"
                    disabled={clearing === identity(doubt)}
                    onClick={() => void clear(doubt)}
                  >
                    {clearing === identity(doubt)
                      ? 'Clearing…'
                      : 'Clear this protection'}
                  </Button>
                  <Button
                    type="small"
                    disabled={clearing === identity(doubt)}
                    onClick={() => {
                      const item = identity(doubt);
                      setConfirming(undefined);
                      setErrors(current => {
                        const next = { ...current };
                        delete next[item];
                        return next;
                      });
                    }}
                  >
                    Keep protection
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="small"
                className="mt-2"
                onClick={() => setConfirming(identity(doubt))}
              >
                I checked Disney — resolve this
              </Button>
            )}
            {errors[identity(doubt)] && (
              <p className="mt-2" role="alert">
                Could not clear protection: {errors[identity(doubt)]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
