import { use, useEffect, useRef } from 'react';

import Home from '@/components/ll/screens/Home';
import AutopilotContext from '@/contexts/AutopilotContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import ResortContext from '@/contexts/ResortContext';
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

import { bridge } from './bridge';
import { World, wdw } from './fakes/world';
import { Scenario } from './scenarios';
import { screenFor } from './screens';

/**
 * `Merlock`'s provider tree, with two things it has no need of: a scenario's
 * state laid over Autopilot's, and a hand on the navigator for the menu that
 * lives outside the app.
 */
export default function HarnessApp({
  scenario,
  world,
  clients,
}: {
  scenario: Scenario;
  world: World;
  clients: Clients;
}) {
  return (
    <ResortContext value={wdw}>
      <ClientsContext value={clients}>
        <DasPartiesProvider>
          <PlansProvider>
            <BookingDateProvider>
              <ParkProvider>
                <ExperiencesProvider>
                  <AutopilotProvider>
                    <ScenarioAutopilot scenario={scenario}>
                      <RebookingProvider>
                        <NavProvider>
                          <HarnessRoot scenario={scenario} world={world} />
                        </NavProvider>
                      </RebookingProvider>
                    </ScenarioAutopilot>
                  </AutopilotProvider>
                </ExperiencesProvider>
              </ParkProvider>
            </BookingDateProvider>
          </PlansProvider>
        </DasPartiesProvider>
      </ClientsContext>
    </ResortContext>
  );
}

/** The real provider's value, with the scenario's fixed fields on top. */
function ScenarioAutopilot({
  scenario,
  children,
}: {
  scenario: Scenario;
  children: React.ReactNode;
}) {
  const real = use(AutopilotContext);
  if (!scenario.autopilot) return children;
  return (
    <AutopilotContext value={{ ...real, ...scenario.autopilot }}>
      {children}
    </AutopilotContext>
  );
}

function HarnessRoot({
  scenario,
  world,
}: {
  scenario: Scenario;
  world: World;
}) {
  const nav = use(NavContext);
  const { plansLoaded } = use(PlansContext);
  const opened = useRef(false);

  useEffect(() => {
    bridge.goTo = nav.goTo;
    return () => {
      bridge.goTo = undefined;
    };
  }, [nav]);

  // Once plans have loaded rather than on mount: NavProvider resets the hash
  // to #0 in its own mount effect, which runs after this one and would
  // swallow a push made here. Time Search also needs a held reservation.
  useEffect(() => {
    if (opened.current || !plansLoaded || !scenario.screen) return;
    const screen = screenFor(scenario.screen, world);
    if (!screen) return;
    opened.current = true;
    nav.goTo(screen);
  }, [plansLoaded, scenario, world, nav]);

  // The shield sits beside Home in `Merlock` for the same reason it does here:
  // it has to cover every screen and outlive the one that raised it. This file
  // mirrors that provider tree by hand, so anything added there has to be
  // added here too or the harness quietly exercises a different app.
  // `TopAutopilotProvider` as well, which this tree was missing: without it the
  // shield read the default context and reported "Off" while the engine beside
  // it said "Watching".
  return (
    <TopAutopilotProvider>
      <PocketShieldProvider>
        <Home tabName={Home.getSavedTabName()} />
      </PocketShieldProvider>
    </TopAutopilotProvider>
  );
}
