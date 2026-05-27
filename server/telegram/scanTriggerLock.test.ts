import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { runAutoSignalScanMock } = vi.hoisted(() => ({ runAutoSignalScanMock: vi.fn() }));
vi.mock('../trading/signalScanner.js', () => ({ runAutoSignalScan: runAutoSignalScanMock }));

import {
  triggerScanInBackground,
  isManualScanInProgress,
  getManualScanStartedAt,
} from './scanTriggerLock.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('scanTriggerLock', () => {
  beforeEach(() => {
    runAutoSignalScanMock.mockReset();
  });

  afterEach(async () => {
    // 다음 테스트로 in-progress 상태가 새지 않도록 보장.
    await vi.waitFor(() => expect(isManualScanInProgress()).toBe(false));
  });

  it('starts a background scan and reports started=true', async () => {
    const d = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d.promise);

    const before = Date.now();
    const result = triggerScanInBackground();

    expect(result).toEqual({ started: true, alreadyRunning: false });
    expect(runAutoSignalScanMock).toHaveBeenCalledTimes(1);
    expect(isManualScanInProgress()).toBe(true);
    expect(getManualScanStartedAt()).toBeGreaterThanOrEqual(before);

    d.resolve({});
    await vi.waitFor(() => expect(isManualScanInProgress()).toBe(false));
  });

  it('skips duplicate trigger while a scan is in progress', async () => {
    const d = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d.promise);

    const first = triggerScanInBackground();
    const second = triggerScanInBackground();

    expect(first).toEqual({ started: true, alreadyRunning: false });
    expect(second).toEqual({ started: false, alreadyRunning: true });
    // 중복 호출은 새 풀스캔을 시작하지 않는다.
    expect(runAutoSignalScanMock).toHaveBeenCalledTimes(1);

    d.resolve({});
    await vi.waitFor(() => expect(isManualScanInProgress()).toBe(false));
  });

  it('invokes onDone after a successful scan and releases the lock', async () => {
    const d = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d.promise);
    const onDone = vi.fn();

    triggerScanInBackground({ onDone });
    expect(onDone).not.toHaveBeenCalled();

    d.resolve({});
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(isManualScanInProgress()).toBe(false);
  });

  it('invokes onError and releases the lock when the scan fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d.promise);
    const onError = vi.fn();

    triggerScanInBackground({ onError });

    d.reject(new Error('scan failed'));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(isManualScanInProgress()).toBe(false);
    errorSpy.mockRestore();
  });

  it('allows a new scan to start after the previous one completes', async () => {
    const d1 = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d1.promise);
    triggerScanInBackground();
    d1.resolve({});
    await vi.waitFor(() => expect(isManualScanInProgress()).toBe(false));

    const d2 = deferred<{ positionFull?: boolean }>();
    runAutoSignalScanMock.mockReturnValueOnce(d2.promise);
    const result = triggerScanInBackground();

    expect(result).toEqual({ started: true, alreadyRunning: false });
    expect(runAutoSignalScanMock).toHaveBeenCalledTimes(2);

    d2.resolve({});
    await vi.waitFor(() => expect(isManualScanInProgress()).toBe(false));
  });
});
