import { COOLDOWN_SECONDS, RateLimit, RateLimitExceeded } from '@/ratelimit';

jest.useFakeTimers();

const REQS_PER_SEC = 5;

function exceed(limit: RateLimit) {
  for (let i = 0; i < REQS_PER_SEC; ++i) limit.enforce();
  expect(() => limit.enforce()).toThrow(RateLimitExceeded);
}

describe('RateLimit', () => {
  it('enforces the cooldown even during the first second', () => {
    const limit = new RateLimit(REQS_PER_SEC);
    exceed(limit);
    jest.advanceTimersByTime(1000);
    expect(() => limit.enforce()).toThrow(RateLimitExceeded);
  });

  it('throws RateLimitExceeded when appropriate', async () => {
    const limit = new RateLimit(REQS_PER_SEC);
    for (let i = 0; i < REQS_PER_SEC; ++i) limit.enforce();
    expect(() => limit.enforce()).toThrow(RateLimitExceeded);
  });

  it('allows a fresh burst in the next second', () => {
    const limit = new RateLimit(REQS_PER_SEC);
    for (let i = 0; i < REQS_PER_SEC; ++i) limit.enforce();
    jest.advanceTimersByTime(1000);
    expect(() => limit.enforce()).not.toThrow();
  });

  it('keeps rejecting for the duration of the cooldown', () => {
    const limit = new RateLimit(REQS_PER_SEC);
    exceed(limit);
    jest.advanceTimersByTime((COOLDOWN_SECONDS - 1) * 1000);
    expect(() => limit.enforce()).toThrow(RateLimitExceeded);
  });

  // Upstream never cleared the exceeded flag, so one burst rejected every
  // later request for the life of the client. A background poller cannot
  // survive that: a trip shortly before a drop would forfeit the drop.
  it('recovers once the cooldown elapses', () => {
    const limit = new RateLimit(REQS_PER_SEC);
    exceed(limit);
    jest.advanceTimersByTime(COOLDOWN_SECONDS * 1000);
    expect(() => limit.enforce()).not.toThrow();
  });

  it('can be tripped again after recovering', () => {
    const limit = new RateLimit(REQS_PER_SEC);
    exceed(limit);
    jest.advanceTimersByTime(COOLDOWN_SECONDS * 1000);
    exceed(limit);
    jest.advanceTimersByTime(COOLDOWN_SECONDS * 1000);
    expect(() => limit.enforce()).not.toThrow();
  });
});
