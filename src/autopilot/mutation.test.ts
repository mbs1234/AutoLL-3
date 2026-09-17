import { ParkTime } from '@/datetime';

import { MutationOperation } from './mutation';

describe('MutationOperation', () => {
  afterEach(() => jest.useRealTimers());

  it('uses the absolute deadline supplied by the authorising tick', async () => {
    jest.useFakeTimers({ now: 80_000, advanceTimers: false });
    const abandoned = jest.fn();
    new MutationOperation({
      id: 'late-operation',
      kind: 'modify',
      abandonAt: 130_000,
      onAbandon: abandoned,
    });
    jest.advanceTimersByTime(49_999);
    expect(abandoned).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(abandoned).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'late-operation' }),
      'deadline'
    );
  });

  it('records the exact dispatch time and evidence', () => {
    jest.useFakeTimers({ now: 1_000, advanceTimers: false });
    const operation = new MutationOperation({
      id: 'move-1',
      kind: 'modify',
      abandonAt: 10_000,
    });
    const evidence = {
      kind: 'modify' as const,
      from: String(new ParkTime(15)),
      to: String(new ParkTime(11)),
      reservationIds: ['ent-1'],
    };
    expect(operation.markDispatched(evidence, 1_234)).toBe(true);
    expect(operation.dispatchedAt).toBe(1_234);
    expect(operation.evidence).toEqual(evidence);
  });

  it('cannot be marked dispatched after it was abandoned', () => {
    jest.useFakeTimers({ now: 0, advanceTimers: false });
    const operation = new MutationOperation({
      id: 'stopped',
      kind: 'book',
      abandonAt: 10_000,
    });
    operation.abandon('stopped');
    expect(operation.signal.aborted).toBe(true);
    expect(operation.markDispatched()).toBe(false);
    expect(operation.dispatched).toBe(false);
  });

  it('does not abort a request after it was dispatched', () => {
    jest.useFakeTimers({ now: 0, advanceTimers: false });
    const operation = new MutationOperation({
      id: 'answer-still-coming',
      kind: 'modify',
      abandonAt: 10_000,
    });
    operation.markDispatched(undefined, 100);

    operation.abandon('stopped');

    expect(operation.abandoned).toBe(true);
    expect(operation.signal.aborted).toBe(false);
  });

  it('cannot be dispatched twice under one mutation identity', () => {
    jest.useFakeTimers({ now: 0, advanceTimers: false });
    const operation = new MutationOperation({
      id: 'one-request',
      kind: 'modify',
      abandonAt: 10_000,
    });
    expect(operation.markDispatched(undefined, 100)).toBe(true);
    expect(operation.markDispatched(undefined, 200)).toBe(false);
    expect(operation.dispatchedAt).toBe(100);
  });

  it('refuses dispatch past the deadline even when the timer was throttled', async () => {
    jest.useFakeTimers({ now: 20_000, advanceTimers: false });
    const abandoned = jest.fn();
    const operation = new MutationOperation({
      id: 'late-boundary',
      kind: 'book',
      abandonAt: 10_000,
      onAbandon: abandoned,
    });

    expect(operation.markDispatched(undefined, 20_000)).toBe(false);
    expect(operation.signal.aborted).toBe(true);
    await operation.waitForAbandonment();
    expect(abandoned).toHaveBeenCalledWith(operation, 'deadline');
  });

  it('settling cancels the deadline', () => {
    jest.useFakeTimers({ now: 0, advanceTimers: false });
    const abandoned = jest.fn();
    const operation = new MutationOperation({
      id: 'settled',
      kind: 'swap',
      abandonAt: 1_000,
      onAbandon: abandoned,
    });
    operation.settle();
    jest.advanceTimersByTime(2_000);
    expect(abandoned).not.toHaveBeenCalled();
  });
});
