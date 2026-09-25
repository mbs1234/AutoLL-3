import { use, useMemo, useRef, useState } from 'react';

import { authStore } from '@/api/auth';
import { APP_NAME, BUILD_REV } from '@/appIdentity';
import { describeLastBackup, lastBackupAt } from '@/autopilot/backup';
import Overlay from '@/components/Overlay';
import NavContext from '@/contexts/NavContext';
// import NewsIcon from '@/icons/NewsIcon';
import BackupIcon from '@/icons/BackupIcon';
// import News from '@/components/screens/News';

import ExitIcon from '@/icons/ExitIcon';
import SettingsIcon from '@/icons/SettingsIcon';
import UserIcon from '@/icons/UserIcon';

import BackupRestore from '../BackupRestore';
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
        text: 'Backup and Restore',
        icon: <BackupIcon />,
        action: () => goTo(<BackupRestore />),
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
        className="min-w-11 self-stretch px-2.5 py-2"
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
            {/* Read each time the menu opens, so it is current without anything
                having to notify it. Here rather than on Today, which is for the
                park day; a reminder to back up belongs with the backup. */}
            <li
              className="px-4 text-center text-sm text-gray-500"
              aria-label="Last backup"
            >
              Last backup: {describeLastBackup(lastBackupAt())}
            </li>
            {/* Which build this is. More than one bg1-derived build can be
                installed on the same phone; this used to sit in the tab bar,
                where five tabs no longer leave it room. */}
            <li
              className="px-4 text-center text-sm text-gray-500"
              aria-label={`Build: ${APP_NAME} ${BUILD_REV}`}
            >
              {APP_NAME} · {BUILD_REV}
            </li>
          </ul>
        </Overlay>
      )}
    </>
  );
}
