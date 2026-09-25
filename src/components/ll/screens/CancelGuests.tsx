import { use, useState } from 'react';

import { DasBooking, LightningLane } from '@/api/itinerary';
import { outcomeIsUnknown } from '@/autopilot/autobook';
import FloatingButton from '@/components/FloatingButton';
import GuestList from '@/components/GuestList';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import ClientsContext from '@/contexts/ClientsContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import useDataLoader from '@/hooks/useDataLoader';

import ReturnTime from '../ReturnTime';
import UnansweredNotice from '../UnansweredNotice';

export default function CancelGuests<B extends LightningLane | DasBooking>({
  booking,
  onCancel,
  dasGuest,
}: {
  booking: B;
  onCancel: (newGuests: B['guests']) => void;
  dasGuest?: B['guests'][0];
}) {
  const { goBack } = use(NavContext);
  const { ll, das } = use(ClientsContext);
  const client = booking.type === 'DAS' ? das : ll;
  const { refreshPlans } = use(PlansContext);
  const [guestsToCancel, setGuestsToCancel] = useState<
    Set<LightningLane['guests'][0]>
  >(new Set());
  const { loadData, loaderElem } = useDataLoader();
  const [unanswered, setUnanswered] = useState(false);

  const { name, park, guests } = booking;
  const cancelingNone = guestsToCancel.size === 0;
  const cancelingAll = guestsToCancel.size === guests.length;

  async function cancelBooking() {
    if (cancelingNone) return;
    let cancelled = false;
    await loadData(async () => {
      try {
        await client.cancelBooking([...guestsToCancel]);
        cancelled = true;
      } catch (error) {
        if (outcomeIsUnknown(error)) setUnanswered(true);
        throw error;
      } finally {
        // Either way. A cancel whose answer was lost may still have landed,
        // and a refused one must not leave Plans showing what it assumed.
        refreshPlans();
      }
    });
    // Only a cancel Disney confirmed leaves this screen. A failed one used to
    // go back anyway and redraw the party without those guests, so a refusal
    // read exactly like success -- with the error gone with the screen.
    if (!cancelled) return;
    await goBack();
    onCancel(guests.filter(g => !guestsToCancel.has(g)));
  }

  return (
    <Screen title="Cancel Guests" theme={park.theme}>
      <h2>{name}</h2>
      <LandLine land={booking.land} />
      <ReturnTime {...booking} />
      <div className="ml-3">
        <label className="flex items-center py-4">
          <input
            type="checkbox"
            checked={cancelingAll}
            onChange={() =>
              setGuestsToCancel(new Set(cancelingAll ? [] : guests))
            }
          />
          <span className="ml-3">Select All</span>
        </label>
      </div>
      {!cancelingNone && (
        <div className="mb-4">
          <h3>Cancel These Guests</h3>
          <GuestList
            guests={guests.filter(g => guestsToCancel.has(g))}
            selectable={{
              isSelected: () => true,
              onToggle: g => {
                if (
                  dasGuest &&
                  g !== dasGuest &&
                  guestsToCancel.has(dasGuest)
                ) {
                  setGuestsToCancel(new Set());
                } else {
                  const newGuests = new Set(guestsToCancel);
                  newGuests.delete(g);
                  setGuestsToCancel(newGuests);
                }
              },
            }}
          />
        </div>
      )}
      {!cancelingAll && (
        <div>
          <h3>Select Guests to Cancel</h3>
          <GuestList
            guests={guests.filter(g => !guestsToCancel.has(g))}
            selectable={{
              isSelected: () => false,
              onToggle: g => {
                setGuestsToCancel(
                  new Set(g === dasGuest ? guests : guestsToCancel).add(g)
                );
              },
            }}
          />
        </div>
      )}
      {unanswered && <UnansweredNotice action="cancel" />}
      <FloatingButton
        disabled={cancelingNone || unanswered}
        onClick={cancelBooking}
      >
        {'Cancel ' + (cancelingAll ? 'Reservation' : 'Guests')}
      </FloatingButton>

      {loaderElem}
    </Screen>
  );
}
