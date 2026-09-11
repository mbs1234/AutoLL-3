import { fireEvent, render, screen, within } from '@testing-library/react';
import { use } from 'react';

import { mk, wdw } from '@/__fixtures__/resort';
import { Experience } from '@/api/ll';
import { WatchTarget } from '@/autopilot/watchlist';
import AutopilotContext from '@/contexts/AutopilotContext';
import { ParkTime } from '@/datetime';

import TargetCard from './TargetCard';

const BZ = '80010114';
const NAME = wdw.experience(BZ).name;

function experience(tier?: number): Experience {
  return {
    ...wdw.experience(BZ),
    park: mk,
    tier,
    standby: { available: true, waitTime: 30 },
    flex: { available: true, nextAvailableTime: new ParkTime(11) },
  } as Experience;
}

const handlers = {
  toggleAutoBook: jest.fn(),
  toggleAutoModify: jest.fn(),
  toggleBookThenMove: jest.fn(),
  togglePaused: jest.fn(),
  toggleAutoSwap: jest.fn(),
  togglePasskey: jest.fn(),
  setTargetWindow: jest.fn(),
  setTargetRank: jest.fn(),
};

/** The default context, with the handlers under test swapped in. */
function Handlers({ children }: { children: React.ReactNode }) {
  const state = use(AutopilotContext);
  return (
    <AutopilotContext value={{ ...state, ...handlers }}>
      {children}
    </AutopilotContext>
  );
}

function setup(target: Partial<WatchTarget> = {}, tier?: number) {
  const onRemove = jest.fn();
  const { unmount } = render(
    <Handlers>
      <TargetCard
        experience={experience(tier)}
        target={{ experienceId: BZ, ...target }}
        onRemove={onRemove}
      />
    </Handlers>
  );
  return {
    onRemove,
    unmount,
    summary: screen.getByText(NAME).closest('summary')!,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('TargetCard', () => {
  it('folds to one line that says what will happen', () => {
    const { summary } = setup({
      autoBook: true,
      rank: 1,
      passkey: true,
      after: new ParkTime(10),
      before: new ParkTime(14),
    });
    const line = within(summary);
    expect(line.getByText(/Auto-book/)).toBeInTheDocument();
    expect(line.getByText(/Rank 1/)).toBeInTheDocument();
    expect(line.getByText(/Passkey/)).toBeInTheDocument();
    expect(summary.querySelector('time[datetime="10:00:00"]')).not.toBeNull();
    expect(summary.querySelector('time[datetime="14:00:00"]')).not.toBeNull();
    expect(line.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says watch only, and says paused ahead of the mode', () => {
    const { summary, unmount } = setup();
    expect(within(summary).getByText(/Watch only/)).toBeInTheDocument();
    unmount();
    const paused = setup({ autoBook: true, paused: true }).summary;
    expect(within(paused).getByText('Paused')).toBeInTheDocument();
    expect(within(paused).getByText(/Auto-book/)).toBeInTheDocument();
  });

  it('opens to the controls, which call back with the id', () => {
    setup();
    screen.getByTitle(`Auto-book ${NAME}`).click();
    expect(handlers.toggleAutoBook).toHaveBeenCalledWith(BZ);
    screen.getByTitle(`Pause ${NAME}`).click();
    expect(handlers.togglePaused).toHaveBeenCalledWith(BZ);
    fireEvent.change(
      screen.getByLabelText(`Earliest return time for ${NAME}`),
      {
        target: { value: '15:30' },
      }
    );
    expect(handlers.setTargetWindow).toHaveBeenCalledWith(BZ, 'after', '15:30');
    fireEvent.change(screen.getByLabelText(`Plan rank for ${NAME}`), {
      target: { value: '2' },
    });
    expect(handlers.setTargetRank).toHaveBeenCalledWith(BZ, 2);
  });

  it('shows the state each chip is in', () => {
    setup({ autoModify: true, autoSwap: true });
    expect(screen.getByTitle(`Stop auto-moving ${NAME}`)).toHaveTextContent(
      'Auto-move on'
    );
    expect(screen.getByTitle(`Stop swapping in ${NAME}`)).toHaveTextContent(
      'Swap in on'
    );
    expect(screen.getByTitle(`Auto-book ${NAME}`)).toHaveTextContent(
      'Auto-book off'
    );
  });

  it('offers a passkey only where one is possible', () => {
    const { unmount } = setup({}, undefined);
    expect(screen.getByTitle(`Use ${NAME} as a passkey`)).toBeInTheDocument();
    unmount();
    setup({}, 1);
    expect(screen.queryByTitle(/passkey/)).not.toBeInTheDocument();
  });

  it('keeps removal inside the body, as a tap you have to open for', () => {
    const { onRemove, summary } = setup();
    expect(
      within(summary).queryByTitle(`Stop watching ${NAME}`)
    ).not.toBeInTheDocument();
    screen.getByTitle(`Stop watching ${NAME}`).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

/**
 * The window is written into the watch list the running poller reads, so an
 * in-progress edit must not reach it. Clearing a bound to retype it used to
 * remove the bound immediately, and a drop landing in that gap was booked at a
 * time the user had explicitly excluded.
 */
describe('TargetCard return-time window editing', () => {
  const earliest = () =>
    screen.getByLabelText(`Earliest return time for ${NAME}`);

  it('commits a complete time straight away', () => {
    setup({ after: new ParkTime(15) });
    fireEvent.change(earliest(), { target: { value: '14:00' } });
    expect(handlers.setTargetWindow).toHaveBeenCalledWith(BZ, 'after', '14:00');
  });

  it('does not clear the bound while the field is empty mid-edit', () => {
    setup({ after: new ParkTime(15) });
    fireEvent.change(earliest(), { target: { value: '' } });
    expect(handlers.setTargetWindow).not.toHaveBeenCalled();
    // The field shows empty so the user can type, while the target keeps 15:00.
    expect(earliest()).toHaveValue('');
  });

  it('commits the replacement typed after clearing, and never the gap', () => {
    setup({ after: new ParkTime(15) });
    fireEvent.change(earliest(), { target: { value: '' } });
    fireEvent.change(earliest(), { target: { value: '14:00' } });
    expect(handlers.setTargetWindow).toHaveBeenCalledTimes(1);
    expect(handlers.setTargetWindow).toHaveBeenCalledWith(BZ, 'after', '14:00');
  });

  // Clearing a bound and leaving is still how you say "no bound".
  it('clears the bound once the emptied field is left', () => {
    setup({ after: new ParkTime(15) });
    fireEvent.change(earliest(), { target: { value: '' } });
    fireEvent.blur(earliest());
    expect(handlers.setTargetWindow).toHaveBeenCalledWith(BZ, 'after', '');
  });

  it('does not commit on blur when nothing was cleared', () => {
    setup({ after: new ParkTime(15) });
    fireEvent.blur(earliest());
    expect(handlers.setTargetWindow).not.toHaveBeenCalled();
  });

  it('treats the latest bound the same way', () => {
    setup({ before: new ParkTime(19) });
    const latest = screen.getByLabelText(`Latest return time for ${NAME}`);
    fireEvent.change(latest, { target: { value: '' } });
    expect(handlers.setTargetWindow).not.toHaveBeenCalled();
    fireEvent.blur(latest);
    expect(handlers.setTargetWindow).toHaveBeenCalledWith(BZ, 'before', '');
  });
});
