// @responsibility Verify asset reload recovery, offline handling and persistent loop prevention.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLazyLoadRecovery } from './lazyLoadRecovery';

let events: EventTarget;
let reload: ReturnType<typeof vi.fn>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let dispose: () => void;
beforeEach(() => {
  events = new EventTarget();
  reload = vi.fn();
  const values = new Map<string, string>();
  storage = { getItem: vi.fn(key => values.get(key)), setItem: vi.fn((key, value) => values.set(key, value)) };
  vi.stubGlobal('window', { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), location: { reload } });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('sessionStorage', storage);
  dispose = installLazyLoadRecovery('build-a');
});
afterEach(() => { dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fail(message = 'Failed to fetch dynamically imported module: /assets/old.js') {
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: new TypeError(message) });
  events.dispatchEvent(event);
  return event;
}

describe('deployment asset recovery', () => {
  it('reloads once and preserves the guard across a remounted application', () => {
    expect(fail().defaultPrevented).toBe(true);
    dispose();
    dispose = installLazyLoadRecovery('build-a');
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    dispose();
    dispose = installLazyLoadRecovery('build-b');
    fail();
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it.each(['Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/old.css'])('recovers browser asset error: %s', message => {
    fail(message);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('leaves ordinary render exceptions visible without reloading', () => {
    expect(fail('Cannot read properties of undefined').defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('keeps the current page available offline and can recover after reconnecting', () => {
    vi.stubGlobal('navigator', { onLine: false });
    fail();
    expect(reload).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    fail();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not risk a reload loop when session storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
