import { useState } from 'react';

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
                      <Home tabName={tabName} />
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
