import { useState } from 'react';

import PocketShield from '@/components/ll/PocketShield';
import PocketShieldContext from '@/contexts/PocketShieldContext';
import AutopilotProvider from '@/providers/AutopilotProvider';
import BookingDateProvider from '@/providers/BookingDateProvider';
import DasPartiesProvider from '@/providers/DasPartiesProvider';
import ExperiencesProvider from '@/providers/ExperiencesProvider';
import NavProvider from '@/providers/NavProvider';
import ParkProvider from '@/providers/ParkProvider';
import PlansProvider from '@/providers/PlansProvider';
import RebookingProvider from '@/providers/RebookingProvider';
import TopAutopilotProvider from '@/providers/TopAutopilotProvider';

import Home from './screens/Home';

export default function Merlock() {
  const [tabName] = useState(Home.getSavedTabName);
  const [shielded, setShielded] = useState(false);
  return (
    <DasPartiesProvider>
      <PlansProvider>
        <BookingDateProvider>
          <ParkProvider>
            <ExperiencesProvider>
              {/* Below ExperiencesProvider because it needs both experiences
                  and plans, and PlansProvider is mounted above. */}
              <AutopilotProvider>
                <TopAutopilotProvider>
                  <RebookingProvider>
                    <NavProvider>
                      {/* Inside the providers so the shield can read the day
                          plan, and outside NavProvider's stack so it covers
                          every screen rather than being hidden with one. */}
                      <PocketShieldContext value={{ shielded, setShielded }}>
                        <Home tabName={tabName} />
                        {shielded && (
                          <PocketShield onExit={() => setShielded(false)} />
                        )}
                      </PocketShieldContext>
                    </NavProvider>
                  </RebookingProvider>
                </TopAutopilotProvider>
              </AutopilotProvider>
            </ExperiencesProvider>
          </ParkProvider>
        </BookingDateProvider>
      </PlansProvider>
    </DasPartiesProvider>
  );
}
