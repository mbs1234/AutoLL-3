import { fireEvent, screen, within } from '@testing-library/react';

import { wdw } from '@/__fixtures__/resort';
import { ParkTime } from '@/datetime';

import Configure from './Configure';
import {
  BZ,
  llExperience,
  nonLLExperience,
  renderScreen,
} from './screenTestSetup';

const setup = (options = {}) => renderScreen(<Configure />, options);
const NAME = wdw.experience(BZ).name;

/**
 * Unfold one of the collapsed sections, as a tap does.
 *
 * The explanations start closed; their contents are in the DOM but not
 * visible until opened, and `toBeVisible` is what tells the difference.
 */
function open(title: string) {
  const summary = screen.getByText(title).closest('summary');
  fireEvent.click(summary!);
  // jsdom does not always apply the default toggle behaviour, and the
  // assertion under test is about the contents rather than the toggle.
  const details = summary!.closest('details');
  if (details && !details.open) details.open = true;
}

describe('Configure watch list', () => {
  it('lists Multi Pass attractions as watchable', () => {
    setup();
    expect(screen.getByTitle(`Watch ${NAME}`)).toBeInTheDocument();
  });

  // Matching reads the `flex` field and there is no Single Pass booking flow,
  // so listing non-Multi-Pass attractions would promise what it cannot do.
  it('omits attractions with no Multi Pass offer', () => {
    setup({ experiences: [nonLLExperience(BZ)] });
    expect(screen.queryByTitle(`Watch ${NAME}`)).not.toBeInTheDocument();
    expect(screen.getByText(/No attractions loaded yet/)).toBeVisible();
  });

  it('adds a target', () => {
    const { addTarget } = setup();
    fireEvent.click(screen.getByTitle(`Watch ${NAME}`));
    expect(addTarget).toHaveBeenCalledWith({ experienceId: BZ });
  });

  it('removes a target from inside its card', () => {
    const { removeTarget } = setup({ watched: [BZ] });
    fireEvent.click(screen.getByTitle(`Stop watching ${NAME}`));
    expect(removeTarget).toHaveBeenCalledWith(BZ);
  });

  it('does not offer to watch something already watched', () => {
    setup({ watched: [BZ] });
    expect(screen.queryByTitle(`Watch ${NAME}`)).not.toBeInTheDocument();
  });

  it('does not mistake a filter with no matches for an empty watch list', () => {
    setup({ watched: [BZ] });
    fireEvent.change(screen.getByLabelText('Filter attractions'), {
      target: { value: 'does not exist' },
    });
    expect(screen.getByText(/No watched attractions match/)).toBeVisible();
    expect(screen.queryByText(/Nothing selected yet/)).not.toBeInTheDocument();
  });

  // A target used to be seven rows tall and its star removed it in one tap.
  it('folds each target to one line that says what will happen', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoBook: true, rank: 1 }],
    });
    const summary = screen.getByText(NAME).closest('summary')!;
    expect(within(summary).getByText(/Auto-book/)).toBeInTheDocument();
    expect(within(summary).getByText(/Rank 1/)).toBeInTheDocument();
  });

  it('offers to undo a removal', () => {
    const { removeTarget, addTarget } = setup({ watched: [BZ] });
    fireEvent.click(screen.getByTitle(`Stop watching ${NAME}`));
    expect(removeTarget).toHaveBeenCalledWith(BZ);
    expect(screen.getByRole('status')).toHaveTextContent(
      `Stopped watching ${NAME}`
    );
    fireEvent.click(screen.getByText('Undo'));
    expect(addTarget).toHaveBeenCalledWith({ experienceId: BZ });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Configure auto-book', () => {
  it('shows auto-book as off by default', () => {
    setup({ watched: [BZ] });
    expect(screen.getByTitle(`Auto-book ${NAME}`)).toHaveTextContent(
      'Auto-book off'
    );
  });

  it('toggles auto-book for one attraction', () => {
    const { toggleAutoBook } = setup({ watched: [BZ] });
    screen.getByTitle(`Auto-book ${NAME}`).click();
    expect(toggleAutoBook).toHaveBeenCalledWith(BZ);
  });

  it('reflects auto-book already on', () => {
    setup({ watched: [BZ], targets: [{ experienceId: BZ, autoBook: true }] });
    expect(screen.getByTitle(`Stop auto-booking ${NAME}`)).toHaveTextContent(
      'Auto-book on'
    );
  });

  // Booking spends a real entitlement, so the consequences are spelled out
  // rather than left implicit in a toggle.
  it('explains the booking limits when any target is armed', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoBook: true }],
      bookedCount: 1,
      bookingsRemaining: 2,
    });
    expect(screen.getByText(/2 of 10 actions left today/)).toBeVisible();
    open('What these actions do');
    expect(screen.getByText(/Automatic booking is on/)).toBeVisible();
  });

  // Book-then-move and swap both imply booking, so both spend the budget.
  // Gating the count on auto-book alone hid it from anyone using only those.
  it.each(['bookThenMove', 'autoSwap', 'autoModify'])(
    'shows the day budget for a target armed only with %s',
    flag => {
      setup({
        watched: [BZ],
        targets: [{ experienceId: BZ, [flag]: true }],
        bookingsRemaining: 2,
      });
      expect(screen.getByText(/2 of 10 actions left today/)).toBeVisible();
    }
  );

  it('says nothing about booking when no target is armed', () => {
    setup({ watched: [BZ] });
    expect(
      screen.queryByText(/Automatic booking is on/)
    ).not.toBeInTheDocument();
  });
});

describe('Configure auto-move', () => {
  it('shows auto-move as off by default', () => {
    setup({ watched: [BZ] });
    expect(screen.getByTitle(`Auto-move ${NAME}`)).toHaveTextContent(
      'Auto-move off'
    );
  });

  it('toggles auto-move independently of auto-book', () => {
    const { toggleAutoModify, toggleAutoBook } = setup({ watched: [BZ] });
    screen.getByTitle(`Auto-move ${NAME}`).click();
    expect(toggleAutoModify).toHaveBeenCalledWith(BZ);
    expect(toggleAutoBook).not.toHaveBeenCalled();
  });

  it('reflects auto-move already on', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoModify: true }],
    });
    expect(screen.getByTitle(`Stop auto-moving ${NAME}`)).toHaveTextContent(
      'Auto-move on'
    );
  });

  // Moving a reservation you already hold can leave the day worse, so the
  // guarantees are spelled out.
  it('explains the auto-move guarantees', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoModify: true }],
    });
    open('What these actions do');
    expect(screen.getByText(/Auto-move is on/)).toBeVisible();
    expect(screen.getByText(/at least 30 minutes/)).toBeVisible();
    expect(screen.getByText(/never to a later time/)).toBeVisible();
  });

  it('says nothing about auto-move when nothing is armed for it', () => {
    setup({ watched: [BZ] });
    expect(screen.queryByText(/Auto-move is on/)).not.toBeInTheDocument();
  });

  it('folds the explanations away until asked', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoModify: true }],
    });
    expect(screen.getByText(/Auto-move is on/)).not.toBeVisible();
    open('What these actions do');
    expect(screen.getByText(/Auto-move is on/)).toBeVisible();
  });
});

describe('Configure book-then-move and pause', () => {
  it('shows book-then-move as off by default', () => {
    setup({ watched: [BZ] });
    expect(screen.getByTitle(`Book then move ${NAME}`)).toHaveTextContent(
      'Book then move off'
    );
  });

  it('toggles book-then-move', () => {
    const { toggleBookThenMove } = setup({ watched: [BZ] });
    screen.getByTitle(`Book then move ${NAME}`).click();
    expect(toggleBookThenMove).toHaveBeenCalledWith(BZ);
  });

  it('explains book-then-move when armed', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, bookThenMove: true }],
    });
    open('What these actions do');
    expect(screen.getByText(/Book then move is on/)).toBeVisible();
    expect(screen.getByText(/even outside your window/)).toBeVisible();
  });

  it('offers to pause by default', () => {
    setup({ watched: [BZ] });
    expect(screen.getByTitle(`Pause ${NAME}`)).toHaveTextContent('Pause');
  });

  it('toggles pause', () => {
    const { togglePaused } = setup({ watched: [BZ] });
    screen.getByTitle(`Pause ${NAME}`).click();
    expect(togglePaused).toHaveBeenCalledWith(BZ);
  });

  it('shows a paused attraction and how many are paused', () => {
    setup({ watched: [BZ], targets: [{ experienceId: BZ, paused: true }] });
    expect(screen.getByTitle(`Resume ${NAME}`)).toHaveTextContent('Paused');
    expect(screen.getByText(/1 paused/)).toBeVisible();
  });

  it('says nothing about pausing when nothing is paused', () => {
    setup({ watched: [BZ] });
    expect(screen.queryByText(/paused\./)).not.toBeInTheDocument();
  });
});

describe('Configure swap', () => {
  it('shows swap as off by default', () => {
    setup({ watched: [BZ] });
    expect(screen.getByTitle(`Swap in ${NAME}`)).toHaveTextContent(
      'Swap in off'
    );
  });

  it('toggles swap', () => {
    const { toggleAutoSwap } = setup({ watched: [BZ] });
    screen.getByTitle(`Swap in ${NAME}`).click();
    expect(toggleAutoSwap).toHaveBeenCalledWith(BZ);
  });

  // Giving up a held reservation is the most consequential thing autopilot
  // does, so what it will and will not give up is spelled out.
  it('explains swapping when armed', () => {
    setup({ watched: [BZ], targets: [{ experienceId: BZ, autoSwap: true }] });
    open('What these actions do');
    expect(screen.getByText(/Swap in is on/)).toBeVisible();
    expect(screen.getByText(/lowest-priority/)).toBeVisible();
    expect(
      screen.getByText(/only released if the new one is secured/)
    ).toBeVisible();
  });
});

describe('Configure settings', () => {
  it('shows the whole-party guard as off by default', () => {
    setup();
    expect(
      screen.getByTitle('Only act when the whole party is eligible')
    ).toHaveTextContent('Whole party only: off');
  });

  it('toggles the whole-party guard', () => {
    const { setRequireWholeParty } = setup();
    screen.getByTitle('Only act when the whole party is eligible').click();
    expect(setRequireWholeParty).toHaveBeenCalledWith(true);
  });

  it('reflects the guard when on and explains it', () => {
    setup({ requireWholeParty: true });
    expect(
      screen.getByTitle('Allow booking for part of the party')
    ).toHaveTextContent('Whole party only: on');
    open('Why these settings?');
    expect(screen.getByText(/never split|worse than none/)).toBeVisible();
  });

  it('can turn clash avoidance off', () => {
    const { setAvoidOverlaps } = setup({ avoidOverlaps: true });
    screen.getByTitle('Allow times that clash with existing plans').click();
    expect(setAvoidOverlaps).toHaveBeenCalledWith(false);
  });

  it('shows dry run as off by default with no banner', () => {
    setup();
    expect(screen.getByTitle('Rehearse without booking')).toHaveTextContent(
      'Dry run: off'
    );
    expect(screen.queryByText(/Dry run is on/)).not.toBeInTheDocument();
  });

  it('toggles dry run', () => {
    const { setDryRun } = setup();
    screen.getByTitle('Rehearse without booking').click();
    expect(setDryRun).toHaveBeenCalledWith(true);
  });

  it('says so while a dry run is on', () => {
    setup({ dryRun: true });
    expect(screen.getByText(/Dry run is on/)).toBeVisible();
    expect(screen.getByTitle('Let autopilot act for real')).toHaveTextContent(
      'Dry run: on'
    );
  });
});

describe('Configure return-time window', () => {
  it('sets a bound from the time inputs', () => {
    const { setTargetWindow } = setup({ watched: [BZ] });
    fireEvent.change(
      screen.getByLabelText(`Earliest return time for ${NAME}`),
      {
        target: { value: '15:30' },
      }
    );
    expect(setTargetWindow).toHaveBeenCalledWith(BZ, 'after', '15:30');
  });

  it('shows the bounds already set', () => {
    setup({
      watched: [BZ],
      targets: [
        {
          experienceId: BZ,
          after: new ParkTime(15, 30),
          before: new ParkTime(19),
        },
      ],
    });
    expect(
      screen.getByLabelText(`Earliest return time for ${NAME}`)
    ).toHaveValue('15:30');
    expect(screen.getByLabelText(`Latest return time for ${NAME}`)).toHaveValue(
      '19:00'
    );
  });

  // Alerting wide is the point: a window that silenced alerts would hide the
  // one thing worth knowing.
  it('says the window limits acting rather than alerting', () => {
    setup({ watched: [BZ] });
    open('What these actions do');
    expect(screen.getByText(/still alerts/)).toBeVisible();
  });
});

describe('Configure unknown attractions', () => {
  // An id missing from the data file is dropped silently: no row, no watch
  // target, no booking, and nothing on screen saying why.
  it('warns when Disney lists an attraction this build does not know', () => {
    setup({ unknownExperienceIds: ['412573652'] });
    expect(screen.getByText(/does not recognise/)).toBeVisible();
    expect(screen.getByText(/412573652/)).toBeVisible();
  });

  it('says nothing when every listed attraction is known', () => {
    setup({});
    expect(screen.queryByText(/does not recognise/)).not.toBeInTheDocument();
  });
});

describe('Configure day allowance', () => {
  const field = () => screen.getByLabelText('Actions allowed per day');

  // Typing "15" passes through "1". A controlled input writing straight
  // through would set the day's budget to 1 mid-keystroke.
  it('commits on blur rather than on every keystroke', () => {
    const { setMaxActionsPerDay } = setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoBook: true }],
      maxActionsPerDay: 10,
    });
    fireEvent.change(field(), { target: { value: '1' } });
    fireEvent.change(field(), { target: { value: '15' } });
    expect(setMaxActionsPerDay).not.toHaveBeenCalled();
    fireEvent.blur(field());
    expect(setMaxActionsPerDay).toHaveBeenCalledTimes(1);
    expect(setMaxActionsPerDay).toHaveBeenCalledWith(15);
  });

  it('shows the allowance currently set', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoSwap: true }],
      maxActionsPerDay: 12,
    });
    expect(field()).toHaveValue(12);
  });
});

// The heading and the list under it are the same fact stated twice, and they
// used to disagree: the heading counted every stored target while the list
// showed only the ones the loaded tipboard covers.
describe('Configure watch count', () => {
  const elsewhere = ['gone_1', 'gone_2', 'gone_3'];

  it('counts what the list actually shows', () => {
    setup({ watched: [BZ, ...elsewhere] });
    expect(screen.getByRole('heading', { name: /Watching/ })).toHaveTextContent(
      'Watching (1)'
    );
  });

  it('says where the rest of the list went, rather than hiding it', () => {
    setup({ watched: [BZ, ...elsewhere] });
    expect(screen.getByText(/3 more saved for another park/)).toBeVisible();
  });

  it('says nothing about other parks when the whole list is here', () => {
    setup({ watched: [BZ] });
    expect(screen.getByRole('heading', { name: /Watching/ })).toHaveTextContent(
      'Watching (1)'
    );
    expect(
      screen.queryByText(/saved for another park/)
    ).not.toBeInTheDocument();
  });

  // Nothing has loaded, so which targets are here is unanswerable. Saying
  // "none" would be a worse guess than saying "all of them".
  it('counts the whole list while the tipboard has not loaded', () => {
    setup({ experiences: [], watched: [BZ, ...elsewhere] });
    expect(screen.getByRole('heading', { name: /Watching/ })).toHaveTextContent(
      'Watching (4)'
    );
  });

  it('names the ones the tipboard has stopped listing', () => {
    setup({
      experiences: [llExperience(BZ)],
      targets: [
        { experienceId: BZ },
        { experienceId: 'gone_1', name: 'Retired Ride' },
      ],
    });
    expect(screen.getByText(/Not on today/)).toBeVisible();
    expect(screen.getByText('Retired Ride')).toBeVisible();
  });
});
