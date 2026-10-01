/**
 * What the pocket screen shows for a search a person started, instead of the
 * day plan's Autopilot.
 *
 * The shield sits above every screen, so it reads the top-level Autopilot. A
 * NextLL search runs in a provider of its own further down, which the shield
 * cannot see, so the search reports itself here, in the words its own screen
 * uses, and the shield shows that while it is set.
 */
export interface PocketSearch {
  /** What it is after: the attraction's name. */
  title: string;
  /** Still checking, done because it has what was asked for, or stopped. */
  state: 'running' | 'done' | 'stopped';
  /** How it stands, one line each. */
  lines: string[];
}

export interface PocketSearchStore {
  get: () => PocketSearch | undefined;
  set: (search: PocketSearch | undefined) => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * A store rather than state, so a search reporting each check re-renders only
 * the shield that shows it, not every screen under the shield's provider.
 */
export function createPocketSearchStore(): PocketSearchStore {
  let current: PocketSearch | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: search => {
      current = search;
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
