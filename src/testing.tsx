import '@testing-library/jest-dom';
import {
  ByRoleMatcher,
  ByRoleOptions,
  act,
  queries as baseQueries,
  screen as baseScreen,
  within as baseWithin,
  buildQueries,
  fireEvent,
  queryHelpers,
  waitForElementToBeRemoved,
} from '@testing-library/react';

import NavContext from './contexts/NavContext';

/* eslint-disable-next-line react-refresh/only-export-components */
export * from '@testing-library/react';

export const YESTERDAY = '2021-09-30';
export const TODAY = '2021-10-01';
export const TOMORROW = '2021-10-02';

function queryAllByTime(c: HTMLElement, time: unknown) {
  time = String(time);
  return [...c.getElementsByTagName('time')].filter(
    elem => elem.dateTime === time || elem.textContent === time
  ) as HTMLElement[];
}

const [queryByTime, getAllByTime, getByTime, findAllByTime, findByTime] =
  buildQueries(
    queryAllByTime,
    (c, time) => `Found multiple time elements: ${time}`,
    (c, time) => `Unable to find a time element: ${time}`
  );
const queries = {
  ...baseQueries,
  queryAllByTime,
  queryByTime,
  getAllByTime,
  getByTime,
  findAllByTime,
  findByTime,
};
export const within = (elem: HTMLElement) =>
  baseWithin<typeof queries>(elem, queries);
export const screen = { ...baseScreen, ...within(document.body) };

function getQueryError(message: string) {
  const error = queryHelpers.getElementError(message, getContainerElem());
  // Adjust the stack trace so Jest will show where the error is in the test
  error.stack = (error.stack || '')
    .split('\n')
    .filter(l => !l.includes(__filename))
    .join('\n');
  return error;
}

const getTextError = (text: string) =>
  getQueryError(`Unable to find element with text: ${text}`);

const getTimeError = (time: unknown) =>
  getQueryError(`Unable to find time element: ${time}`);

const getContainerElem = () =>
  document.querySelector<HTMLElement>('article:not([hidden])') ?? document.body;

const withinActive = () => within(getContainerElem());

export const see = Object.assign(
  (text: string, role?: ByRoleMatcher, options?: ByRoleOptions) => {
    if (role) {
      try {
        return screen.getByRole(role, { ...options, name: text });
      } catch {
        // pass through
      }
    } else {
      const c = withinActive();
      for (const q of [c.getByText, c.getByTitle, c.getByLabelText]) {
        try {
          return q(text);
        } catch {
          continue;
        }
      }
    }
    throw getTextError(text);
  },
  {
    time(time: unknown) {
      try {
        return withinActive().getByTime(time);
      } catch {
        throw getTimeError(time);
      }
    },
    times(time: string) {
      try {
        return withinActive().getAllByTime(time);
      } catch {
        throw getTimeError(time);
      }
    },
    all(text: string) {
      const { queryAllByText, queryAllByTitle } = withinActive();
      try {
        return [...queryAllByText(text), ...queryAllByTitle(text)];
      } catch {
        throw getTextError(text);
      }
    },
    no(text: string, role?: ByRoleMatcher) {
      const { queryByRole, queryByText } = withinActive();
      try {
        return expect(
          role ? queryByRole(role, { name: text }) : queryByText(text)
        ).not.toBeInTheDocument();
      } catch {
        throw getQueryError(`Found element with text: ${text}`);
      }
    },
    async screen(title: string) {
      try {
        await screen.findByRole('heading', { name: title, level: 1 });
      } catch {
        throw getQueryError(`Unable to find screen with title: ${title}`);
      }
    },
  }
);

export function click(textOrElem: string | HTMLElement, role?: ByRoleMatcher) {
  let elem: HTMLElement | undefined;
  if (textOrElem instanceof HTMLElement) {
    elem = textOrElem;
  } else {
    try {
      elem = see(textOrElem, role);
    } catch (error) {
      if (!role) {
        elem = see(textOrElem, 'button');
      } else {
        throw error;
      }
    }
  }
  if (elem) fireEvent.click(elem);
}

export async function loading() {
  try {
    await waitForElementToBeRemoved(
      () => withinActive().queryByLabelText('Loading…'),
      { timeout: 5000 }
    );
  } catch {
    throw getQueryError("Didn't show loading spinner");
  }
}

/**
 * Waits out a refresh of data already on screen, which shows a thin bar along
 * the top rather than the spinner `loading` waits for.
 */
export async function refreshing() {
  try {
    await waitForElementToBeRemoved(
      () => withinActive().queryByRole('status', { name: 'Refreshing…' }),
      { timeout: 5000 }
    );
  } catch {
    throw getQueryError("Didn't show the refreshing bar");
  }
}

export function setTime(time: unknown, minutes = 0) {
  const now = new Date(`${TODAY}T${time}-0400`);
  jest.useFakeTimers({ now });
  if (minutes) jest.advanceTimersByTime(minutes * 60_000);
}

Element.prototype.scroll ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

const MK_DUMBO_COORDS = [28.4206047, -81.5789092] as const;
let globalCoords: readonly [number, number] | undefined = MK_DUMBO_COORDS;
Object.defineProperty(navigator, 'geolocation', {
  value: {
    getCurrentPosition(onSuccess: any, onError: any) {
      if (globalCoords) {
        onSuccess({
          coords: { latitude: globalCoords[0], longitude: globalCoords[1] },
        });
      } else {
        onError({ code: 2, message: 'Position unavailable' });
      }
    },
  },
});

export async function withCoords(
  coords: typeof globalCoords | undefined,
  callback: () => void | Promise<void>
) {
  const origCoords = globalCoords;
  globalCoords = coords;
  await callback();
  globalCoords = origCoords;
}

let hidden = false;
Object.defineProperty(document, 'hidden', { get: () => hidden });

export function toggleVisibility() {
  hidden = !hidden;
  document.dispatchEvent(new Event('visibilitychange'));
}

export function revisitTab(delaySec = 60) {
  act(() => {
    toggleVisibility();
    jest.advanceTimersByTime(delaySec * 1000);
    toggleVisibility();
  });
}

export const nav = {
  goTo: jest.fn(),
  goBack: jest.fn(),
  Provider: ({ children }: { children: React.ReactNode }) => {
    return <NavContext value={nav}>{children}</NavContext>;
  },
};
