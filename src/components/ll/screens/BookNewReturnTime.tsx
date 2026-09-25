import { use, useEffect, useState } from 'react';

import { LLMP, Offer } from '@/api/ll';
import { outcomeIsUnknown } from '@/autopilot/autobook';
import Button from '@/components/Button';
import FloatingButton from '@/components/FloatingButton';
import GuestList from '@/components/GuestList';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import ClientsContext from '@/contexts/ClientsContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import RebookingContext from '@/contexts/RebookingContext';
import ResortContext from '@/contexts/ResortContext';
import useDataLoader from '@/hooks/useDataLoader';
import { ping } from '@/ping';

import BookingDate from '../BookingDate';
import OverlappingPlans from '../OverlappingPlans';
import RebookingHeader from '../RebookingHeader';
import ReturnTime from '../ReturnTime';
import UnansweredNotice from '../UnansweredNotice';
import YourDayButton from '../YourDayButton';
import BookingDetails from './BookingDetails';
import Home from './Home';
import SelectReturnTime from './SelectReturnTime';

export default function BookNewReturnTime({
  offer: initialOffer,
}: {
  offer: Offer<LLMP>;
}) {
  const { goTo, goBack } = use(NavContext);
  const rebooking = use(RebookingContext);
  const resort = use(ResortContext);
  const { ll } = use(ClientsContext);
  const { loadData, loaderElem } = useDataLoader();
  const { refreshPlans } = use(PlansContext);
  const [offer, setOffer] = useState(initialOffer);
  const [unanswered, setUnanswered] = useState(false);
  const { booking } = offer;

  useEffect(() => {
    const begin = rebooking.begin;
    begin(booking, true);
    return rebooking.end;
  }, [booking, rebooking.begin, rebooking.end]);

  function book() {
    loadData(async () => {
      let booking: LLMP;
      try {
        booking = await ll.book(offer);
      } catch (error) {
        // No answer is not a failure: the move may have happened. Stop
        // offering the same tap, and send the person to Plans.
        if (outcomeIsUnknown(error)) {
          setUnanswered(true);
          refreshPlans();
        }
        throw error;
      }
      refreshPlans();
      await goBack({ screen: Home });
      goTo(<BookingDetails booking={booking} isNew />);
      ping(resort, 'G');
    });
  }

  return (
    <Screen
      title="Lightning Lane"
      subhead={
        <>
          <RebookingHeader back={{ screen: BookingDetails }} />
          <BookingDate booking={booking} />
        </>
      }
      theme={offer.experience.park.theme}
      buttons={<YourDayButton />}
    >
      <h2>{offer.experience.name}</h2>
      <LandLine land={offer.experience.land} />
      <ReturnTime
        {...offer}
        button={
          <Button
            type="small"
            onClick={() => {
              goTo(<SelectReturnTime offer={offer} onOfferChange={setOffer} />);
            }}
          >
            Change
          </Button>
        }
      />
      <OverlappingPlans offer={offer} />
      <h3>Your Party</h3>
      <GuestList guests={offer.guests.eligible} />
      {loaderElem}
      {unanswered ? (
        <UnansweredNotice action="change" />
      ) : (
        <FloatingButton onClick={book}>Modify Lightning Lane</FloatingButton>
      )}
    </Screen>
  );
}
