import { use, useEffect, useRef } from 'react';

import withTabs from '@/components/withTabs';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import RebookingContext from '@/contexts/RebookingContext';
import ThemeContext from '@/contexts/ThemeContext';
import useScreenState from '@/hooks/useScreenState';
import CalendarIcon from '@/icons/CalendarIcon';
import ClockIcon from '@/icons/ClockIcon';
import DayIcon from '@/icons/DayIcon';
import DropIcon from '@/icons/DropIcon';
import LightningIcon from '@/icons/LightningIcon';
import kvdb from '@/kvdb';
import onVisible from '@/onVisible';

import MultiPassList from './Home/MultiPassList';
import NextLLTab from './Home/NextLL';
import SettingsButton from './Home/SettingsButton';
import TimesGuide from './Home/TimesGuide';
import Plans from './Plans';
import Today from './Today';

const AUTO_REFRESH_MIN_MS = 60_000;
export const HOME_TAB_KEY = 'autoll3.tab';

export interface HomeTabProps {
  ref: React.RefObject<HTMLDivElement | null>;
}

const tabs = [
  {
    name: 'Today' as const,
    icon: <DayIcon />,
    component: Today,
  },
  {
    name: 'LL' as const,
    icon: <LightningIcon />,
    component: MultiPassList,
  },
  {
    name: 'Times' as const,
    icon: <ClockIcon />,
    component: TimesGuide,
  },
  {
    name: 'Plans' as const,
    icon: <CalendarIcon />,
    component: Plans,
  },
  {
    name: 'NextLL' as const,
    icon: <DropIcon />,
    component: NextLLTab,
  },
];

const footer = <SettingsButton />;

const Home = Object.assign(
  withTabs({ tabs, footer }, ({ tab }) => {
    const { isActiveScreen } = useScreenState();
    const rebooking = use(RebookingContext);
    const { park } = use(ParkContext);
    const { refreshExperiences } = use(ExperiencesContext);
    const { refreshPlans } = use(PlansContext);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      kvdb.set<string>(HOME_TAB_KEY, tab.name);
    }, [tab]);

    useEffect(() => {
      return onVisible(() => {
        if (!isActiveScreen) return;
        refreshExperiences(AUTO_REFRESH_MIN_MS);
        refreshPlans(AUTO_REFRESH_MIN_MS);
      });
    }, [isActiveScreen, refreshExperiences, refreshPlans]);

    useEffect(() => {
      if (rebooking.current) ref.current?.scroll(0, 0);
    }, [rebooking]);

    return (
      <ThemeContext value={park.theme}>
        <tab.component ref={ref} />
      </ThemeContext>
    );
  }),
  {
    getSavedTabName() {
      const tabName = kvdb.get(HOME_TAB_KEY);
      return tabs.find(t => t.name === tabName)
        ? (tabName as (typeof tabs)[0]['name'])
        : 'Today';
    },
  }
);

export default Home;
