import { anyRunning, markRunning, subscribeRunning } from './running';

describe('running', () => {
  it('counts every engine, not only the first', () => {
    expect(anyRunning()).toBe(false);
    const main = markRunning();
    const search = markRunning();
    main();
    expect(anyRunning()).toBe(true);
    search();
    expect(anyRunning()).toBe(false);
  });

  // An effect's cleanup can run twice under StrictMode. A second release must
  // not count another engine as stopped.
  it('releases each engine once, however often its cleanup runs', () => {
    const main = markRunning();
    const search = markRunning();
    main();
    main();
    expect(anyRunning()).toBe(true);
    search();
  });

  it('tells subscribers when the answer changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeRunning(listener);
    const release = markRunning();
    release();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    markRunning()();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
