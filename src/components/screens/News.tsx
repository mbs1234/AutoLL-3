import { APP_NAME, PAGES_BASE } from '@/appIdentity';

import Screen from '../Screen';

export default function News() {
  return (
    <Screen title={`${APP_NAME} News`}>
      <iframe
        src={`${PAGES_BASE}/news.html`}
        className="absolute inset-0 w-full h-full"
      />
    </Screen>
  );
}
