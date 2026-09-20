import { useState } from 'react';

import AutopilotProvider from '@/providers/AutopilotProvider';
import BookingDateProvider from '@/providers/BookingDateProvider';
import DasPartiesProvider from '@/providers/DasPartiesProvider';
import ExperiencesProvider from '@/providers/ExperiencesProvider';
import NavProvider from '@/providers/NavProvider';
import ParkProvider from '@/providers/ParkProvider';
import PlansProvider from '@/providers/PlansProvider';
import PocketShieldProvider from '@/providers/PocketShieldProvider';
import RebookingProvider from '@/providers/RebookingProvider';
import TopAutopilotProvider from '@/providers/TopAutopilotProvider';

import Home from './screens/Home';

export default function Merlock() {
  const [tabName] = useState(Home.getSavedTabName);
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
                    {/* Above NavProvider, not below. NavProvider renders the
                        nav stack as its OWN children, and `goTo` replaces a
                        stack entry wholesale -- a tab change swaps entry 0 for
                        a bare `<Tabbed>` -- so a provider mounted inside those
                        children is discarded the first time any screen is
                        pushed or replaced. Up here the stack renders beneath
                        it and the shield renders beside it. */}
                    <PocketShieldProvider>
                      <NavProvider>
                        <Home tabName={tabName} />
                      </NavProvider>
                    </PocketShieldProvider>
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
