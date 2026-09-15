import { createContext } from 'react';

export interface Screens {
  activeScreen: React.ReactNode;
  prevScreen?: React.ReactNode;
  /**
   * The nav stack position's key, which is what identifies a screen.
   *
   * `activeScreen` is a React element and cannot be compared for identity over
   * time: `withTabs` replaces the active element on every tab change, so a
   * screen that captured the element at mount saw every later comparison fail
   * and believed it was no longer active. The key survives a `replace` -- that
   * is the same position in the stack -- and changes only when the stack moves,
   * which is exactly what "is this screen still the one on top" means.
   */
  activeKey: number;
}

export default createContext<Screens>({ activeScreen: null, activeKey: 0 });
