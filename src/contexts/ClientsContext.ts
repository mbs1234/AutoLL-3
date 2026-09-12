import { createContext } from 'react';

import { DasClient } from '@/api/das';
import { ItineraryClient } from '@/api/itinerary';
import { LiveDataClient } from '@/api/livedata';
import { LLClient } from '@/api/ll';
import { LLClientWDW } from '@/api/ll/wdw';
import { Resort } from '@/api/resort';
import { loadSavedPartyIds } from '@/savedParty';

export interface Clients {
  das: DasClient;
  itinerary: ItineraryClient;
  liveData: LiveDataClient;
  ll: LLClient;
}

export default createContext<Clients>({
  das: {} as DasClient,
  itinerary: {} as ItineraryClient,
  liveData: {} as LiveDataClient,
  ll: {} as LLClient,
});

export function createClients(resort: Resort) {
  const das = new DasClient(resort);
  const liveData = new LiveDataClient(resort);
  const ll = new LLClientWDW(resort);
  // The party is applied here rather than only by `useSavedParty`, which
  // mounts on three screens the app no longer has to open: `Home` renders
  // only the active tab, and the saved tab is `Today`. Opened there, nothing
  // called `setPartyIds`, an empty set disables the filter in `parseGuest`
  // outright, and autopilot booked for every eligible guest on the account
  // while the context strip said "party of 3".
  ll.setPartyIds(loadSavedPartyIds());
  const itinerary = new ItineraryClient(resort);
  itinerary.onRefresh = bookings => ll.track(bookings);
  return { das, itinerary, liveData, ll };
}
