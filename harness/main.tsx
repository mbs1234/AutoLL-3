import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HOME_TAB_KEY } from '@/components/ll/screens/Home';
import kvdb from '@/kvdb';

import HarnessApp from './HarnessApp';
import HarnessMenu from './HarnessMenu';
import { createFakeClients } from './fakes/clients';
import { World } from './fakes/world';
import { DEFAULT_FRAME, FRAMES } from './frames';
import './harness.css';
import { findScenario } from './scenarios';

/**
 * The preview harness: `?scenario=<id>&frame=<WxH|none>&keep=1`.
 *
 * Storage belongs to this origin alone, so every load starts from the
 * scenario's seed unless asked to keep what the last load left behind. The
 * world and the clients are made once, here, before anything mounts: React's
 * StrictMode renders twice in development, and a second world would be a
 * second set of plans.
 */
const params = new URLSearchParams(location.search);
const scenario = findScenario(params.get('scenario'));
const frameName = params.get('frame') ?? DEFAULT_FRAME;
const frame = FRAMES[frameName];

if (params.get('keep') !== '1') kvdb.clear();
scenario.seed?.();
if (scenario.tab) kvdb.set(HOME_TAB_KEY, scenario.tab);

const world = new World(scenario.script);
const clients = createFakeClients(world);
document.title = `AutoLL-3 harness: ${scenario.title}`;

const app = <HarnessApp scenario={scenario} world={world} clients={clients} />;

createRoot(document.getElementById('harness')!).render(
  <StrictMode>
    {frame ? (
      <div className="flex min-h-full items-start gap-6 bg-neutral-100 p-6">
        {/* The transform makes this the containing block for the app's
            `fixed` screens, so they fill the frame rather than the page. */}
        <div
          className="relative shrink-0 overflow-hidden rounded-[2.5rem] border-[10px] border-neutral-900 bg-white shadow-2xl"
          style={{
            width: frame.width,
            height: frame.height,
            transform: 'translateZ(0)',
          }}
        >
          {app}
        </div>
        <HarnessMenu scenario={scenario} frame={frameName} world={world} />
      </div>
    ) : (
      <>
        {app}
        <HarnessMenu
          scenario={scenario}
          frame={frameName}
          world={world}
          compact
        />
      </>
    )}
  </StrictMode>
);
