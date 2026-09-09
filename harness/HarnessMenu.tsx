import kvdb from '@/kvdb';

import { bridge } from './bridge';
import { World } from './fakes/world';
import { FRAMES } from './frames';
import { SCENARIOS, Scenario } from './scenarios';
import { SCREEN_TITLES, ScreenName, screenFor } from './screens';

function setParam(key: string, value: string) {
  const params = new URLSearchParams(location.search);
  params.set(key, value);
  // A new scenario or frame starts clean; `keep` is for reloading this one.
  params.delete('keep');
  location.search = params.toString();
}

const button =
  'rounded-md border border-neutral-400 bg-white px-2 py-1 text-black hover:bg-neutral-100 disabled:opacity-40';

/**
 * The controls around the app: which scenario, which frame, which screen.
 *
 * Outside the app's tree on purpose. Inside it the menu would be a screen in
 * the navigation stack, hidden as soon as anything was pushed on top.
 */
export default function HarnessMenu({
  scenario,
  frame,
  world,
  compact,
}: {
  scenario: Scenario;
  frame: string;
  world: World;
  /** A small pill over the app, for when there is no frame beside it. */
  compact?: boolean;
}) {
  const open = (name: ScreenName) => {
    const screen = screenFor(name, world);
    if (screen) bridge.goTo?.(screen);
  };

  const body = (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Scenario</span>
        <select
          className="rounded-md border border-neutral-400 p-1"
          value={scenario.id}
          onChange={e => setParam('scenario', e.target.value)}
        >
          {SCENARIOS.map(s => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <p className="text-neutral-700">{scenario.blurb}</p>
      <label className="flex items-center gap-2">
        <span className="font-semibold">Frame</span>
        <select
          className="rounded-md border border-neutral-400 p-1"
          value={frame}
          onChange={e => setParam('frame', e.target.value)}
        >
          {Object.keys(FRAMES).map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        <button className={button} onClick={() => history.back()}>
          ← Back
        </button>
        {(Object.keys(SCREEN_TITLES) as ScreenName[]).map(name => (
          <button
            key={name}
            className={button}
            disabled={name === 'timesearch' && world.heldToday().length === 0}
            onClick={() => open(name)}
          >
            {SCREEN_TITLES[name]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          onClick={() => {
            const params = new URLSearchParams(location.search);
            params.set('keep', '1');
            location.search = params.toString();
          }}
        >
          Reload, keep storage
        </button>
        <button
          className={button}
          onClick={() => {
            kvdb.clear();
            location.reload();
          }}
        >
          Reset storage
        </button>
      </div>
      <p className="text-xs text-neutral-600">
        {scenario.autopilot
          ? 'Static Autopilot state: the screen shows a fixed picture, and its controls act on the real provider underneath.'
          : 'The real engine runs against fake clients. Nothing here talks to Disney.'}{' '}
        A frame does not change the viewport, so the one xs: breakpoint reads as
        desktop; pick frame “none” and resize the browser to check that.
      </p>
    </div>
  );

  if (compact) {
    return (
      <details className="fixed top-1/2 right-2 z-30 max-w-72 -translate-y-1/2 rounded-lg border border-neutral-400 bg-white/95 p-2 text-sm text-black shadow-lg">
        <summary className="cursor-pointer font-semibold select-none">
          Harness
        </summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <aside className="w-80 shrink-0 text-sm text-black">
      <h1 className="mb-3 text-lg font-semibold">AutoLL-3 harness</h1>
      {body}
    </aside>
  );
}
