import { booking, ll, modOffer, renderResort } from '@/__fixtures__/ll';
import { RequestError } from '@/api/client';
import {
  acquire,
  leaseKey,
  quarantine,
  quarantinedAt,
} from '@/autopilot/lease';
import BookNewReturnTime from '@/components/ll/screens/BookNewReturnTime';
import CancelGuests from '@/components/ll/screens/CancelGuests';
import { TODAY, cleanup, click, loading, setTime } from '@/testing';

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  setTime('10:00:00');
  ll.book.mockResolvedValue(booking);
  ll.cancelBooking.mockResolvedValue(undefined);
});

test('manual Modify must not send while another engine owns its reservation', async () => {
  const key = leaseKey(booking.facilityId, TODAY);
  expect(await acquire(key, 'running-engine')).toBe(true);
  renderResort(<BookNewReturnTime offer={modOffer} />);
  click('Modify Lightning Lane');
  await loading();
  expect(ll.book.mock.calls.length).toBe(0);
});

test('manual Cancel must respect an unresolved mutation', async () => {
  await quarantine(leaseKey(booking.facilityId, TODAY), {
    kind: 'modify',
    to: '12:00:00',
    reservationIds: [booking.id],
  });
  renderResort(<CancelGuests booking={booking} onCancel={() => {}} />);
  click('Select All');
  click('Cancel Reservation');
  await loading();
  expect(ll.cancelBooking.mock.calls.length).toBe(0);
});

test('manual unknown Modify must leave durable quarantine', async () => {
  ll.book.mockRejectedValueOnce(
    new RequestError({ ok: false, status: 0, data: null })
  );
  renderResort(<BookNewReturnTime offer={modOffer} />);
  click('Modify Lightning Lane');
  await loading();
  cleanup();
  expect(quarantinedAt(leaseKey(booking.facilityId, TODAY))).toBeDefined();
});

test('reopening a manual screen must not forget its unanswered Modify', async () => {
  ll.book.mockRejectedValueOnce(
    new RequestError({ ok: false, status: 0, data: null })
  );
  renderResort(<BookNewReturnTime offer={modOffer} />);
  click('Modify Lightning Lane');
  await loading();
  cleanup();
  renderResort(<BookNewReturnTime offer={modOffer} />);
  click('Modify Lightning Lane');
  await loading();
  expect(ll.book).toHaveBeenCalledTimes(1);
});
