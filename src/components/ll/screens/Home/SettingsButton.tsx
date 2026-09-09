import { use, useMemo, useRef, useState } from 'react';

import { authStore } from '@/api/auth';
import { APP_NAME } from '@/appIdentity';
import Overlay from '@/components/Overlay';
import NavContext from '@/contexts/NavContext';
// import News from '@/components/screens/News';

import ExitIcon from '@/icons/ExitIcon';
// import NewsIcon from '@/icons/NewsIcon';
import SettingsIcon from '@/icons/SettingsIcon';
import UserIcon from '@/icons/UserIcon';

import PartySelector from '../PartySelector';

export default function SettingsButton() {
  const { goTo } = use(NavContext);
  const sessionStatus = authStore.getStatus();
  const [sessionOnly, setSessionOnly] = useState(
    () => authStore.getPersistence() === 'session'
  );
  const options = useMemo(
    () => [
      {
        text: 'Party Selection',
        icon: <UserIcon />,
        action: () => goTo(<PartySelector />),
      },
      {
        text: 'Log Out',
        icon: <ExitIcon />,
        action: () => authStore.deleteData(),
      },
      {
        text: `Session-only login: ${sessionOnly ? 'On' : 'Off'}`,
        icon: <UserIcon />,
        action: () => {
          const next = !sessionOnly;
          authStore.setPersistence(next ? 'session' : 'persistent');
          setSessionOnly(next);
        },
      },
      // {
      //   text: 'BG1 News',
      //   icon: <NewsIcon />,
      //   action: () => goTo(<News />),
      // },
    ],
    [goTo, sessionOnly]
  );
  const [showingMenu, showMenu] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <>
      <button
        className="absolute top-0 right-0 h-full px-4"
        onClick={() => showMenu(true)}
        title="Settings Menu"
      >
        <SettingsIcon />
      </button>
      {showingMenu && (
        <Overlay
          onClick={event => {
            if (!listRef.current?.contains(event.target as Element)) {
              showMenu(false);
            }
          }}
          data-testid="shade"
        >
          <ul
            className="dividers overflow-auto min-w-[50%] max-h-[90%] rounded-lg bg-white text-black text-lg font-normal"
            ref={listRef}
          >
            {options.map(opt => {
              return (
                <li key={opt.text}>
                  <button
                    className="flex items-center w-full px-4"
                    onClick={() => {
                      showMenu(false);
                      setTimeout(opt.action, 50);
                    }}
                  >
                    <span className="mr-2.5 text-gray-700" aria-hidden>
                      {opt.icon}
                    </span>
                    {opt.text}
                  </button>
                </li>
              );
            })}
            <li
              className="px-4 text-center text-sm text-gray-500"
              aria-label="Session status"
            >
              Session: {sessionStatus.replaceAll('-', ' ')}
            </li>
            {/* Which build this is. More than one bg1-derived build can be
                installed on the same phone; this used to sit in the tab bar,
                where five tabs no longer leave it room. */}
            <li
              className="px-4 text-center text-sm text-gray-500"
              aria-label={`Build: ${APP_NAME}`}
            >
              {APP_NAME}
            </li>
          </ul>
        </Overlay>
      )}
    </>
  );
}
