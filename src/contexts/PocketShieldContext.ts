import { createContext } from 'react';

/**
 * Whether the screen is guarded, and how to guard it.
 *
 * A context rather than state on Today, because the shield has to cover every
 * screen and outlive the one that raised it. `NavProvider` keeps stacked
 * screens mounted and merely hides them, so a shield rendered inside Today
 * would be hidden along with Today the moment anything else came up.
 */
export default createContext<{
  shielded: boolean;
  setShielded: (on: boolean) => void;
}>({ shielded: false, setShielded: () => undefined });
