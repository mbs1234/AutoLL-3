import { use, useCallback, useEffect, useState } from 'react';

import { isLLMP } from '@/api/itinerary';
import { Guest, LLMP, Offer, OfferError, OfferExperience } from '@/api/ll';
import { outcomeIsUnknown } from '@/autopilot/autobook';
import FloatingButton from '@/components/FloatingButton';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import { Time } from '@/components/Time';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import PartyContext, { Party } from '@/contexts/PartyContext';
import PlansContext from '@/contexts/PlansContext';
import RebookingContext from '@/contexts/RebookingContext';
import ResortContext from '@/contexts/ResortContext';
import { parkDate, upcomingTimes } from '@/datetime';
import useDataLoader from '@/hooks/useDataLoader';
import useScreenState from '@/hooks/useScreenState';
import { ping } from '@/ping';

import BookingDate from '../BookingDate';
import ExistingBookings from '../ExistingBookings';
import RebookingHeader from '../RebookingHeader';
import UnansweredNotice from '../UnansweredNotice';
import YourDayButton from '../YourDayButton';
import NoEligibleGuests from './BookExperience/NoEligibleGuests';
import NoGuestsFound from './BookExperience/NoGuestsFound';
import NoReservationsAvailable from './BookExperience/NoReservationsAvailable';
import OfferDetails from './BookExperience/OfferDetails';
import BookingDetails from './BookingDetails';
import RefreshButton from './RefreshButton';

export default function BookExperience({
  experience,
}: {
  experience: OfferExperience;
}) {
  const { goTo } = use(NavContext);
  const { isActiveScreen } = useScreenState();
  const resort = use(ResortContext);
  const { ll } = use(ClientsContext);
  const { experiences } = use(ExperiencesContext);
  const { plans, plansLoaded, refreshPlans } = use(PlansContext);
  const { bookingDate } = use(BookingDateContext);
  const rebooking = use(RebookingContext);
  const fullExp = experiences.find(e => e.id === experience.id);
  const [party, setParty] = useState<Party>();
  const [offer, setOffer] = useState<Offer | null | undefined>();
  const { loadData, loaderElem } = useDataLoader();
  const [unanswered, setUnanswered] = useState(false);

  useEffect(() => {
    if (!isActiveScreen) return;
    setOffer(offer => (offer?.id !== ll.lastOffer?.id ? undefined : offer));
  }, [isActiveScreen, ll]);

  useEffect(() => {
    setParty(undefined);
    setOffer(undefined);
    if (rebooking.auto) return rebooking.end;
  }, [rebooking]);

  async function book() {
    if (!offer || !party) return;
    loadData(async flash => {
      let booking: LLMP;
      try {
        booking = await ll.book(offer, party.selected);
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 410) {
          flash('Offer expired — refreshing…', 'error');
          setOffer(undefined); // triggers auto-refresh
          return;
        }
        // No answer is not a failure: the booking may exist. The button used
        // to stay live under a three-second error, one tap from a second
        // booking. It gives way to a pointer to Plans instead.
        if (outcomeIsUnknown(error)) {
          setUnanswered(true);
          refreshPlans();
        }
        throw error; // let useDataLoader handle other errors
      }
      rebooking.end();
      const selectedIds = new Set(party.selected.map(g => g.id));
      const guestsToCancel = booking.guests.filter(g => !selectedIds.has(g.id));
      let warning: string | undefined;
      if (guestsToCancel.length > 0) {
        try {
          await ll.cancelBooking(guestsToCancel);
          booking.guests = booking.guests.filter(g => selectedIds.has(g.id));
        } catch (error) {
          // The booking went through, for everyone on the offer. Staying on
          // this screen made it look as though nothing had been booked.
          console.error(error);
          warning = `Booked for everyone on the offer, but removing ${guestsToCancel
            .map(g => g.name)
            .join(', ')} failed. Cancel them here if they should not have it.`;
        }
      }
      goTo(
        <BookingDetails booking={booking} isNew={true} warning={warning} />,
        { replace: true }
      );
      refreshPlans();
      ping(resort, 'G');
    });
  }

  const loadParty = useCallback(() => {
    loadData(async () => {
      const guests = rebooking.current
        ? { eligible: rebooking.current.guests, ineligible: [] }
        : await ll.guests(experience, bookingDate);

      // Detect if there's an existing LL for this experience we can modify
      if (
        guests.eligible.length === 0 &&
        guests.ineligible.some(
          g => g.ineligibleReason === 'EXPERIENCE_LIMIT_REACHED'
        )
      ) {
        const sameExpLLs = plans
          .filter(isLLMP)
          .filter(
            b =>
              b.experience.id === experience.id &&
              !!b.modifiable &&
              parkDate(b.start) === bookingDate
          );
        if (sameExpLLs.length === 1) {
          return rebooking.begin(sameExpLLs[0]!, true);
        }
      }

      setParty({
        ...guests,
        selected: guests.eligible.slice(0, ll.rules.maxPartySize),
        setSelected(guests: Guest[]) {
          const oldSelected = new Set(this.selected);
          setOffer(offer =>
            offer === null || guests.some(g => !oldSelected.has(g))
              ? undefined
              : offer
          );
          setParty({ ...this, selected: guests });
        },
        experience,
      } as Party);
    });
  }, [plans, ll, experience, bookingDate, rebooking, loadData]);

  useEffect(() => {
    if (!party && plansLoaded) loadParty();
  }, [party, plansLoaded, loadParty]);

  const refreshOffer = useCallback(
    (first = false) => {
      if (!party || party.selected.length === 0) return;

      function updateParty({ guests }: Pick<Offer, 'guests'>) {
        setParty(party => ({
          ...(party as Party),
          ...guests,
          selected: guests.eligible,
        }));
      }

      loadData(
        async () => {
          try {
            const newOffer = await ll.offer(
              experience,
              party.selected,
              rebooking.current
                ? { booking: rebooking.current }
                : { date: bookingDate }
            );
            const { ineligible } = newOffer.guests;
            if (ineligible.length > 0) {
              const ineligibleIds = new Set(ineligible.map(g => g.id));
              const isEligible = (g: Guest) => !ineligibleIds.has(g.id);
              setParty({
                ...party,
                eligible: party.eligible.filter(isEligible),
                ineligible: [...ineligible, ...party.ineligible],
                selected: party.selected.filter(isEligible),
              });
            }
            if (!first) newOffer.changed = false;
            setOffer(newOffer);
            if (ineligible.length > 0) updateParty(newOffer);
          } catch (error) {
            setOffer(offer => offer ?? null);
            if (error instanceof OfferError) return updateParty(error);
            throw error;
          }
        },
        {
          messages: { 410: first ? '' : 'No reservations available' },
        }
      );
    },
    [ll, experience, party, bookingDate, rebooking, loadData]
  );

  useEffect(() => {
    if (offer === undefined) refreshOffer(true);
  }, [offer, refreshOffer]);

  const noEligible = party?.eligible.length === 0;
  const noGuestsFound = noEligible && party?.ineligible.length === 0;

  return (
    <Screen
      title="Lightning Lane"
      theme={experience.park.theme}
      buttons={
        <>
          <YourDayButton />
          <RefreshButton
            onClick={() => {
              if (noEligible) {
                loadParty();
              } else {
                refreshOffer();
              }
            }}
            name={noEligible ? 'Party' : 'Offer'}
          />
        </>
      }
      subhead={
        <>
          <RebookingHeader back={rebooking.auto} />
          <BookingDate booking={offer ?? undefined} />
        </>
      }
    >
      <h2>
        {experience.name}
        {experience.tier !== undefined && (
          <span className="ml-2 text-sm font-normal text-gray-500">
            Tier {experience.tier}
          </span>
        )}
      </h2>
      <LandLine land={experience.land} />
      {(fullExp?.standby ||
        experience.dropTimes ||
        experience.flex?.nextAvailableTime) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-600">
          {fullExp?.standby.available &&
            fullExp.standby.waitTime !== undefined && (
              <span>
                Standby:{' '}
                <span className="font-semibold">
                  {fullExp.standby.waitTime} min
                </span>
              </span>
            )}
          {fullExp?.standby.available &&
            fullExp.standby.waitTime === undefined && (
              <span>
                Standby: <span className="font-semibold">now</span>
              </span>
            )}
          {experience.flex?.nextAvailableTime && (
            <span>
              Next LL:{' '}
              <Time
                time={experience.flex.nextAvailableTime}
                className="font-semibold"
              />
            </span>
          )}
          {experience.dropTimes &&
            experience.dropTimes.length > 0 &&
            (() => {
              const upcoming = upcomingTimes(experience.dropTimes!);
              return upcoming.length > 0 ? (
                <span>
                  Drop:{' '}
                  {upcoming.map((t, i) => (
                    <span key={+t}>
                      {i > 0 && ', '}
                      <Time
                        time={t}
                        className={i === 0 ? 'font-semibold' : ''}
                      />
                    </span>
                  ))}
                </span>
              ) : null;
            })()}
        </div>
      )}
      <ExistingBookings experience={experience} />
      {party ? (
        <PartyContext value={party}>
          {noGuestsFound ? (
            <NoGuestsFound onRefresh={loadParty} />
          ) : noEligible ? (
            <NoEligibleGuests />
          ) : !party || offer === undefined ? (
            <div />
          ) : offer === null ? (
            <NoReservationsAvailable />
          ) : (
            <>
              <OfferDetails offer={offer} onOfferChange={setOffer} />
              {unanswered ? (
                <UnansweredNotice
                  action={rebooking.current ? 'change' : 'booking'}
                />
              ) : (
                <FloatingButton onClick={book}>{`${
                  rebooking.current ? 'Modify' : 'Book'
                } Lightning Lane`}</FloatingButton>
              )}
            </>
          )}
        </PartyContext>
      ) : !plansLoaded ? (
        <Spinner />
      ) : null}
      {loaderElem}
    </Screen>
  );
}
