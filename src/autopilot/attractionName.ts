import type { Experience } from '@/api/ll';
import type { Resort } from '@/api/resort';

/**
 * A facility id turned into something a person recognises.
 *
 * The tip board is the best source and the wrong one to rely on alone: it is
 * scoped to one park and one date and empties on every change, while the things
 * that need naming are not. A doubt is about a reservation on its own park day,
 * often weeks out; a drop summary is about an attraction that may not be on
 * today's board at all. Falling back to the raw id put `80010190` on screen
 * where "Space Mountain" belonged.
 *
 * So the resort catalogue answers second. It knows every shipped facility
 * whatever day is on screen, and `knows()` is asked first because `experience()`
 * throws for an id the data deliberately ignores.
 *
 * The id itself is the last resort, and it is still the right answer there: an
 * attraction Disney has listed and this build has never heard of has no name to
 * give, and printing the id is how the unrecognised-ID warning gets something
 * to point at.
 *
 * One function because this is the third place it was needed and the second
 * time it was written -- `Activity` kept a raw-id version fourteen lines above
 * the panel whose identical bug had just been fixed.
 */
export function attractionName(
  id: string,
  experiences: Pick<Experience, 'id' | 'name'>[],
  resort: Pick<Resort, 'knows' | 'experience'>
): string {
  const onBoard = experiences.find(experience => experience.id === id)?.name;
  if (onBoard) return onBoard;
  if (resort.knows(id)) {
    try {
      return resort.experience(id).name;
    } catch {
      // An explicitly ignored catalogue entry has no usable display name.
    }
  }
  return id;
}
