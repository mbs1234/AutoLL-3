import { hm, jc, mk, sm } from '@/__fixtures__/ll';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import { click, render, screen, waitFor, withCoords } from '@/testing';

import useSort from './useSort';

const experiences = [hm, jc, sm];

function SortTest() {
  const { sorter, sortSelect } = useSort();
  return (
    <div>
      <div data-testid="ids">
        {experiences
          .sort(sorter)
          .map(exp => exp.id)
          .join(',')}
      </div>
      {sortSelect()}
    </div>
  );
}

const ids = (exps: { id: string }[]) => exps.map(exp => exp.id);
const sortedIds = () => screen.getByTestId('ids').textContent?.split(',');

function sortBy(type: string) {
  click('Sort By');
  click(type);
}

function Contexts({
  exps,
  children,
}: {
  exps: typeof experiences;
  children: React.ReactNode;
}) {
  return (
    <ParkContext value={{ park: mk, setPark: () => {} }}>
      <ExperiencesContext
        value={{
          experiences: exps,
          refreshExperiences: () => null,
          pollExperiences: async () => [],
          loaderElem: null,
        }}
      >
        {children}
      </ExperiencesContext>
    </ParkContext>
  );
}

describe('useSort()', () => {
  // Returned as a component defined inside the hook, the control was a new
  // type on every render, so each update remounted it and an open Sort menu
  // closed by itself -- during a drop, before anyone could choose.
  it('keeps the Sort menu open across an update', () => {
    const { rerender } = render(
      <Contexts exps={experiences}>
        <SortTest />
      </Contexts>
    );
    click('Sort By');
    const menu = screen.getByRole('form', { name: 'Sort By Selection' });
    rerender(
      <Contexts exps={[...experiences]}>
        <SortTest />
      </Contexts>
    );
    expect(menu).toBeInTheDocument();
  });

  it('sorts', async () => {
    render(
      <ParkContext value={{ park: mk, setPark: () => {} }}>
        <ExperiencesContext
          value={{
            experiences,
            refreshExperiences: () => null,
            pollExperiences: async () => [],
            loaderElem: null,
          }}
        >
          <SortTest />
        </ExperiencesContext>
      </ParkContext>
    );
    expect(sortedIds()).toEqual(ids([jc, sm, hm]));
    sortBy('Standby');
    expect(sortedIds()).toEqual(ids([sm, jc, hm]));
    sortBy('Soonest');
    expect(sortedIds()).toEqual(ids([sm, hm, jc]));
    sortBy('A to Z');
    expect(sortedIds()).toEqual(ids([hm, jc, sm]));
    await withCoords(jc.geo, async () => {
      sortBy('Nearby');
      await waitFor(() => expect(sortedIds()).toEqual(ids([jc, hm, sm])));
    });
  });
});
