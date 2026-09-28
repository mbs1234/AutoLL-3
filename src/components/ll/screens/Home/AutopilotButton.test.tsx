import { use } from 'react';

import AutopilotContext, { AutopilotState } from '@/contexts/AutopilotContext';
import TabsContext from '@/contexts/TabContext';
import { fireEvent, render, screen } from '@/testing';

import AutopilotButton from './AutopilotButton';

/** The default context, with a scenario's fields laid on top. */
function State({
  state,
  children,
}: {
  state: Partial<AutopilotState>;
  children: React.ReactNode;
}) {
  const real = use(AutopilotContext);
  return (
    <AutopilotContext value={{ ...real, ...state }}>
      {children}
    </AutopilotContext>
  );
}

function setup(state: Partial<AutopilotState> = {}) {
  const changeTab = jest.fn();
  render(
    <TabsContext
      value={{
        tabs: [],
        active: { name: 'LL', icon: null, component: () => null },
        changeTab,
        scrollPos: { get: () => 0, set: () => {} },
      }}
    >
      <State state={state}>
        <AutopilotButton />
      </State>
    </TabsContext>
  );
  return { changeTab, button: screen.getByRole('button') };
}

const idle = { mode: 'idle' as const, consecutiveFailures: 0, polls: 3 };

describe('AutopilotButton', () => {
  it('switches to the Today tab, where the switch is', () => {
    const { changeTab, button } = setup();
    fireEvent.click(button);
    expect(changeTab).toHaveBeenCalledWith('Today');
  });

  it('says it is off, in grey', () => {
    const { button } = setup();
    expect(button).toHaveAttribute('title', 'Autopilot off');
    expect(button.className).not.toMatch(/green|yellow|red/);
  });

  it('says it is running, counts what it watches, and goes green', () => {
    const { button } = setup({
      enabled: true,
      status: idle,
      targetsHere: [{ experienceId: 'a' }, { experienceId: 'b' }],
    });
    expect(button).toHaveAttribute('title', 'Autopilot on, watching 2');
    expect(button).toHaveTextContent('2');
    expect(button).toHaveClass('bg-green-700');
  });

  it('is yellow for a dry run and red once stopped', () => {
    const rehearsing = setup({ enabled: true, status: idle, dryRun: true });
    expect(rehearsing.button).toHaveClass('bg-yellow-600');
    expect(rehearsing.button).toHaveAttribute(
      'title',
      'Autopilot on (dry run), watching 0'
    );
  });

  it('asks for attention once the poller has stopped', () => {
    const { button } = setup({
      enabled: true,
      status: { mode: 'stopped', consecutiveFailures: 5, polls: 9 },
    });
    expect(button).toHaveClass('bg-red-700');
    expect(button).toHaveAttribute(
      'title',
      'Autopilot stopped after repeated errors'
    );
  });

  // A refusal and a run of errors call for opposite responses, so the light
  // says which it was.
  it('says when the stop was Disney refusing', () => {
    const { button } = setup({
      enabled: true,
      status: {
        mode: 'stopped',
        stopReason: 'refused',
        consecutiveFailures: 0,
        polls: 9,
      },
    });
    expect(button).toHaveClass('bg-red-700');
    expect(button).toHaveAttribute(
      'title',
      'Autopilot stopped: Disney refused a request'
    );
  });

  // Still on and still armed: amber, not the red of a stop.
  it('shows a wait Disney asked for as neither running nor stopped', () => {
    const { button } = setup({
      enabled: true,
      status: {
        mode: 'waiting',
        waitUntil: Date.now() + 60_000,
        consecutiveFailures: 0,
        polls: 9,
      },
    });
    expect(button).toHaveClass('bg-amber-600');
    expect(button).toHaveAttribute(
      'title',
      'Autopilot waiting: Disney asked to slow down'
    );
  });
});
