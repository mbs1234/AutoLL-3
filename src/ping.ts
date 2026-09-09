import { Resort } from '@/api/resort';
import { DateTime } from '@/datetime';
import kvdb from '@/kvdb';

const PING_URL = 'https://bg1.joelface.com/ping';

// Upstream reports an anonymized daily usage count (resort + service) to the
// author's server. Disabled in this fork -- a personal build has no reason to
// phone home. Flip `enabled` to restore upstream behavior.
//
// Deliberately a property on a mutable object rather than `const X: boolean`:
// a plain annotated boolean trips @typescript-eslint/no-inferrable-types, and
// an unannotated `= false` narrows to the literal type, making the rest of
// this function unreachable to the type checker.
const PING = { enabled: false };

type ServiceCode = 'D' | 'G' | 'V';

export async function ping(
  resort: Pick<Resort, 'id'>,
  service: ServiceCode
): Promise<void> {
  if (!PING.enabled) return;
  const { date } = DateTime.now();
  const pingDateKey = `autoll3.ping.${resort.id}.${service}`;
  const pingDate = kvdb.get<string>(pingDateKey);
  if (pingDate === date) return;
  const { ok } = await fetch(PING_URL, {
    method: 'POST',
    body: new URLSearchParams({ resort: resort.id, service }),
  });
  if (ok) kvdb.set<string>(pingDateKey, date);
}
