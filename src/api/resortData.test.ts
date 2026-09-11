/**
 * Consistency checks over the resort data file.
 *
 * Kept beside `src/api/data/` rather than in it: that directory holds data
 * only, and this file reads the data source as text through `node:fs`, which
 * has no place in the bundle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as wdw from './data/wdw';
import { ResortData } from './resort';

/**
 * Which `// <Park> - <Type>` section each experience id is declared under.
 *
 * Read from the source text because the comments are gone by runtime. The
 * sections are the file's own statement of intent, so comparing them against
 * the `land` each entry actually points at catches the copy-paste that put
 * two Animal Kingdom entries in EPCOT's World Discovery -- a mistake nothing
 * else notices, since the tipboard corrects `park` on the way through but
 * `Itinerary.experienceData()` does not.
 */
function sectionsByExperienceId(file: string): Map<string, string> {
  const src = readFileSync(join(__dirname, 'data', file), 'utf8');
  const sections = new Map<string, string>();
  let park = '';
  for (const line of src.split('\n')) {
    const section = /^ {2}\/\/ (.+?) - \w+$/.exec(line);
    if (section?.[1]) park = section[1];
    else if (/^ {2}\/\/ Ignored$/.test(line)) park = '';
    const entry = /^ {2}(\d+): \{$/.exec(line);
    if (entry?.[1] && park) sections.set(entry[1], park);
  }
  return sections;
}

describe.each([['wdw.ts', wdw as unknown as ResortData]])(
  '%s',
  (file, data) => {
    const sections = sectionsByExperienceId(file);

    it('declares every experience under a park section', () => {
      const ids = Object.entries(data.experiences)
        .filter(([, exp]) => !!exp)
        .map(([id]) => id);
      expect([...sections.keys()].sort()).toEqual(ids.sort());
    });

    // `comparePriority` reads a missing priority as Infinity, which is right
    // for attempt order and dangerous for a Tier 1: the party can hold only one
    // at a time, so an unranked Tier 1 sorted last of everything -- attempted
    // last, never worth a hold, and offered up as the preferred swap victim.
    // Millennium Falcon shipped that way, so Alien Swirling Saucers outranked
    // it.
    it('gives every Tier 1 experience a priority', () => {
      const unranked = Object.entries(data.experiences)
        .filter(
          ([, exp]) => exp && exp.tier === 1 && exp.priority === undefined
        )
        .map(([id, exp]) => `${id} ${exp?.name}`);
      expect(unranked).toEqual([]);
    });

    // One ride served under several facility ids -- a film rotation, a seasonal
    // overlay -- must not change rank with the id, or the same queue is worth
    // more on some days than others and can be swapped away on the rest.
    //
    // Same coordinates *and* the same average wait is the test for "one ride":
    // the coordinates alone group Mission: SPACE with Living with the Land, and
    // a genuine overlay that draws a different crowd earns a different rank
    // honestly -- Jingle Cruise waits 53 minutes against Jungle Cruise's 37.
    // Soarin's three films all wait 35, so they had no such excuse.
    it('ranks one ride the same under every facility id it is served as', () => {
      const groups = new Map<string, { name: string; priority?: number }[]>();
      for (const exp of Object.values(data.experiences)) {
        if (!exp?.geo || exp.avgWait === undefined) continue;
        const key = `${exp.geo.join()}@${exp.avgWait}`;
        groups.set(key, [
          ...(groups.get(key) ?? []),
          { name: exp.name, priority: exp.priority },
        ]);
      }
      const inconsistent = [...groups]
        .filter(([, v]) => new Set(v.map(e => e.priority)).size > 1)
        .map(
          ([key, v]) =>
            `${key}: ${v.map(e => `${e.name}=${e.priority}`).join(', ')}`
        );
      expect(inconsistent).toEqual([]);
    });

    it('puts every experience in a land belonging to its section park', () => {
      const wrong = [...sections].flatMap(([id, park]) => {
        const exp = data.experiences[id];
        if (!exp || exp.land.park.name === park) return [];
        return [
          `${id} ${exp.name}: ${park} section, ${exp.land.park.name} land`,
        ];
      });
      expect(wrong).toEqual([]);
    });
  }
);

describe('wdw.ts', () => {
  // Disney re-issues a facility id when an attraction is re-themed, and an id
  // missing from this file is dropped silently by `LLClient.experiences()`.
  // These three cost a headliner each when they went stale in 2026.
  it.each([
    ['412573652', "Rock 'n' Roller Coaster Starring The Muppets"],
    ['412577054', "Soarin' Across America"],
    ['412521565', 'Disney Jr. Mickey Mouse Clubhouse Live!'],
  ])('carries the current facility id %s', (id, name) => {
    expect(wdw.experiences[id]).toMatchObject({ name });
  });

  it('keeps retired ids listed as null rather than deleting them', () => {
    // Null suppresses the "Missing experience" warning if Disney serves one
    // again, and records that the id was considered rather than overlooked.
    expect(wdw.experiences['80010182']).toBeNull();
    expect(wdw.experiences['19583373']).toBeNull();
  });
});
